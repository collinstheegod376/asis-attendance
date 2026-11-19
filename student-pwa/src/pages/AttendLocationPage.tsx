import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, AlertTriangle, RefreshCw, ArrowRight, ShieldCheck, ChevronDown } from 'lucide-react';
import { Header } from '../components/Header';
import {
  getAttemptState,
  updateAttemptLocation,
  clearAttemptLocation,
  clearAttemptState,
  isLocationRequirementSatisfied,
} from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';
import { heartbeatManager } from '../lib/heartbeatManager';
import {
  MAX_ALLOWED_ACCURACY_M,
  ACCURACY_RETRY_THRESHOLD_M,
  ACCURACY_RETRY_TIMEOUT_MS,
  TARGET_HIGH_ACCURACY_M,
  SETTLE_WINDOW_MS,
  MAX_ACQUISITION_WINDOW_MS,
  MIN_CONSISTENT_SAMPLES_FAST_LOCK,
  MAX_FAST_LOCK_SPREAD_M,
  haversineDistanceMeters,
  normalizeGpsTimestamp,
  validateGpsFix,
  detectTeleportationJump,
  selectConsistentClusterAndAverage,
  formatLowAccuracyMessage,
  acquirePreciseLocation,
} from '../lib/preciseLocation';
import type { GpsFix, PreciseLocation } from '../lib/preciseLocation';

interface BoundaryFailureDetails {
  code: string;
  message: string;
  distanceM?: number;
  allowedRadiusM?: number;
  accuracyM: number;
}

export const AttendLocationPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    sampleCount?: number;
  } | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [boundaryMetrics, setBoundaryMetrics] = useState<{
    distanceM?: number;
    allowedRadiusM?: number;
    accuracyM?: number;
  } | null>(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
  const [liveSampleCount, setLiveSampleCount] = useState<number>(0);
  const [gpsProgressStep, setGpsProgressStep] = useState<string>('Acquiring satellite GPS lock...');

  const activeSessionCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef(true);

  const stopActiveGpsWatch = useCallback(() => {
    if (activeSessionCleanupRef.current) {
      activeSessionCleanupRef.current();
      activeSessionCleanupRef.current = null;
    }
  }, []);

  const requestLocation = useCallback(() => {
    const currentAttempt = getAttemptState();

    // If lecturer has not enabled location verification, skip GPS and go straight to selfie capture
    if (currentAttempt?.session?.location_enabled !== true) {
      navigate('/attend/selfie', { replace: true });
      return;
    }

    if (!currentAttempt?.attempt_token) {
      clearAttemptState();
      navigate('/expired', { replace: true });
      return;
    }

    // Cancel any previous active watcher or timers and clear any prior verified location before retrying
    stopActiveGpsWatch();
    clearAttemptLocation();

    setLoading(true);
    setErrorStatus(null);
    setBoundaryMetrics(null);
    setVerifiedSuccess(false);
    setBoundaryStatus(null);
    setLiveAccuracy(null);
    setLiveSampleCount(0);
    setGpsProgressStep('Waking up hardware GPS satellite receiver...');

    if (!('geolocation' in navigator)) {
      setErrorStatus('Geolocation is not supported by your mobile browser.');
      setLoading(false);
      return;
    }

    const attemptToken = currentAttempt.attempt_token;
    const attemptId = currentAttempt.attempt_id;
    const startTime = Date.now();

    let cancelled = false;
    let watchId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let searchWindowTimer: ReturnType<typeof setTimeout> | null = null;

    const validSamples: GpsFix[] = [];
    let lastAcceptedFix: GpsFix | null = null;
    let bestClusteredFix: PreciseLocation | null = null;
    let lastVerifiedFix: PreciseLocation | null = null;
    let pendingVerifyFix: PreciseLocation | null = null;
    let lastFailure: BoundaryFailureDetails | null = null;
    let bestRejectedAccuracyM: number | null = null;
    let sawStaleFix = false;
    let sawInvalidFix = false;
    let verificationInFlight = false;
    let settleWindowElapsed = false;
    let searchWindowClosed = false;
    let verifyAttemptsCount = 0;
    let hasRunAccuracyRetry = false;

    const cleanup = () => {
      cancelled = true;
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (searchWindowTimer !== null) {
        clearTimeout(searchWindowTimer);
        searchWindowTimer = null;
      }
    };

    activeSessionCleanupRef.current = cleanup;

    const renderFinalFailure = (
      failure: BoundaryFailureDetails | null,
      fallbackFix: PreciseLocation | null
    ) => {
      if (!isMountedRef.current) return;
      cleanup();
      setVerifiedSuccess(false);

      const finalAcc =
        failure?.accuracyM && failure.accuracyM > 0
          ? failure.accuracyM
          : fallbackFix?.accuracy ?? bestRejectedAccuracyM ?? undefined;

      if (fallbackFix) {
        setCoords({
          lat: fallbackFix.latitude,
          lng: fallbackFix.longitude,
          accuracy: fallbackFix.accuracy,
          sampleCount: fallbackFix.sampleCount,
        });
      }

      if (failure) {
        if (failure.code === 'LOW_ACCURACY') {
          setBoundaryMetrics(finalAcc !== undefined ? { accuracyM: finalAcc } : null);
          setErrorStatus(formatLowAccuracyMessage(finalAcc, MAX_ALLOWED_ACCURACY_M));
        } else if (failure.code === 'GPS_TELEPORT_DETECTED' || failure.code === 'SUSPICIOUS_GPS') {
          setBoundaryMetrics(finalAcc !== undefined ? { accuracyM: finalAcc } : null);
          setErrorStatus(failure.message);
        } else if (failure.code === 'STALE_LOCATION') {
          setBoundaryMetrics(null);
          setErrorStatus(failure.message);
        } else if (failure.code === 'OUTSIDE_CLASSROOM_BOUNDARY') {
          const allowedRadius = failure.allowedRadiusM ?? 50;
          const distPart =
            failure.distanceM !== undefined
              ? ` Measured distance: ${failure.distanceM.toFixed(1)}m (allowed radius: ${allowedRadius}m).`
              : ` Allowed radius: ${allowedRadius}m.`;
          setBoundaryMetrics({
            distanceM: failure.distanceM,
            allowedRadiusM: allowedRadius,
            accuracyM: finalAcc,
          });
          setErrorStatus(
            `You are outside the classroom boundary. You must be within ${allowedRadius}m of the lecturer to sign attendance.${distPart}`
          );
        } else if (failure.code === 'OUTSIDE_CAMPUS_BOUNDARY') {
          setBoundaryMetrics(finalAcc !== undefined ? { accuracyM: finalAcc } : null);
          setErrorStatus('You are outside the permitted lecture hall / campus boundary.');
        } else if (failure.code === 'NO_CLASSROOM_LOCATION' || failure.code === 'GEOFENCE_NOT_CONFIGURED') {
          setErrorStatus(
            'This lecture session does not have a classroom location configured. Please notify your lecturer.'
          );
        } else {
          setErrorStatus(failure.message || 'Location could not be verified. Tap retry.');
        }
      } else {
        setErrorStatus(
          'GPS satellite lock timed out before confirming classroom boundary. Move near a window or turn on Precise Location & Wi-Fi scanning, then retry.'
        );
      }

      setLoading(false);
    };

    const hasSignificantImprovement = (
      candidate: PreciseLocation,
      previousVerified: PreciseLocation | null
    ): boolean => {
      if (!previousVerified) return true;
      const accImprovedM = previousVerified.accuracy - candidate.accuracy;
      const accImprovedRatio = accImprovedM / Math.max(previousVerified.accuracy, 1);
      const coordShiftM = haversineDistanceMeters(
        previousVerified.latitude,
        previousVerified.longitude,
        candidate.latitude,
        candidate.longitude
      );
      return (
        accImprovedM >= 3 ||
        accImprovedRatio >= 0.12 ||
        (candidate.sampleCount > previousVerified.sampleCount && coordShiftM >= 2.5) ||
        (coordShiftM >= 3 && candidate.accuracy <= Math.max(previousVerified.accuracy, 35))
      );
    };

    const extractFailureFromResultOrError = (
      code: string,
      message: string,
      data: any,
      fixAccuracy: number
    ): BoundaryFailureDetails => {
      const rawDist = data?.distance_m;
      const rawRadius = data?.allowed_radius_m;
      return {
        code,
        message,
        distanceM: rawDist !== undefined && !isNaN(Number(rawDist)) ? Number(rawDist) : undefined,
        allowedRadiusM: rawRadius !== undefined && !isNaN(Number(rawRadius)) ? Number(rawRadius) : undefined,
        accuracyM: fixAccuracy,
      };
    };

    const verifyFixWithBackend = async (
      fixToVerify: PreciseLocation,
      isFinalAttempt = false
    ): Promise<void> => {
      if (cancelled || !isMountedRef.current) return;

      // Hard client-side accuracy gate: never submit readings > 65m to /api/verify-location
      if (fixToVerify.accuracy > MAX_ALLOWED_ACCURACY_M) {
        if (isFinalAttempt || searchWindowClosed) {
          renderFinalFailure(
            {
              code: 'LOW_ACCURACY',
              message: formatLowAccuracyMessage(fixToVerify.accuracy, MAX_ALLOWED_ACCURACY_M),
              accuracyM: fixToVerify.accuracy,
            },
            null
          );
        }
        return;
      }

      if (verificationInFlight) {
        if (
          !pendingVerifyFix ||
          fixToVerify.accuracy < pendingVerifyFix.accuracy ||
          fixToVerify.sampleCount > pendingVerifyFix.sampleCount
        ) {
          pendingVerifyFix = fixToVerify;
        }
        return;
      }

      verificationInFlight = true;
      verifyAttemptsCount += 1;
      lastVerifiedFix = fixToVerify;

      if (isMountedRef.current) {
        setCoords({
          lat: fixToVerify.latitude,
          lng: fixToVerify.longitude,
          accuracy: fixToVerify.accuracy,
          sampleCount: fixToVerify.sampleCount,
        });
        setGpsProgressStep(
          verifyAttemptsCount === 1
            ? `Verifying classroom boundary (±${fixToVerify.accuracy.toFixed(1)}m · ${fixToVerify.sampleCount} sample${fixToVerify.sampleCount === 1 ? '' : 's'})...`
            : `Re-verifying converged GNSS cluster #${verifyAttemptsCount} (±${fixToVerify.accuracy.toFixed(1)}m · ${fixToVerify.sampleCount} samples)...`
        );
      }

      let retriableFailure: BoundaryFailureDetails | null = null;

      try {
        const result = await attendanceService.verifyLocation({
          attemptToken,
          attemptId,
          latitude: fixToVerify.latitude,
          longitude: fixToVerify.longitude,
          accuracyM: fixToVerify.accuracy,
        });

        if (cancelled || !isMountedRef.current) return;

        // Fail closed: require BOTH success === true AND inside_boundary === true
        if (result.success === true && result.inside_boundary === true) {
          cleanup();
          const radiusLabel = result.allowed_radius_m ?? 50;
          const distLabel =
            result.distance_m !== undefined
              ? `${Number(result.distance_m).toFixed(1)}m from lecturer • Within ${radiusLabel}m boundary`
              : `Inside classroom geofence (${radiusLabel}m)`;
          setBoundaryStatus(distLabel);
          setCoords({
            lat: fixToVerify.latitude,
            lng: fixToVerify.longitude,
            accuracy: fixToVerify.accuracy,
            sampleCount: fixToVerify.sampleCount,
          });
          updateAttemptLocation({
            latitude: fixToVerify.latitude,
            longitude: fixToVerify.longitude,
            accuracy_m: fixToVerify.accuracy,
            verified_at: new Date().toISOString(),
            inside_boundary: true,
          });
          heartbeatManager.start();
          setVerifiedSuccess(true);
          setLoading(false);
          return;
        }

        // Handle non-throwing failure or inside_boundary !== true
        const errCode =
          result.error ||
          (result.success === true && result.inside_boundary !== true
            ? 'OUTSIDE_CLASSROOM_BOUNDARY'
            : 'LOCATION_VERIFICATION_FAILED');

        if (errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED') {
          cleanup();
          clearAttemptState();
          navigate('/expired', { replace: true });
          return;
        }
        if (errCode === 'SESSION_CLOSED' || errCode === 'SESSION_ENDED') {
          cleanup();
          clearAttemptState();
          navigate('/closed', { replace: true });
          return;
        }
        if (errCode === 'NO_CLASSROOM_LOCATION' || errCode === 'GEOFENCE_NOT_CONFIGURED') {
          renderFinalFailure(
            extractFailureFromResultOrError(errCode, result.message || '', result, fixToVerify.accuracy),
            fixToVerify
          );
          return;
        }

        retriableFailure = extractFailureFromResultOrError(
          errCode,
          result.message || 'Location could not be verified.',
          result,
          fixToVerify.accuracy
        );
      } catch (err: any) {
        if (cancelled || !isMountedRef.current) return;

        if (err instanceof ApiError) {
          if (err.code === 'ATTEMPT_EXPIRED' || err.code === 'SESSION_EXPIRED' || err.status === 410) {
            cleanup();
            clearAttemptState();
            navigate('/expired', { replace: true });
            return;
          }
          if (err.code === 'SESSION_CLOSED' || err.code === 'SESSION_ENDED') {
            cleanup();
            clearAttemptState();
            navigate('/closed', { replace: true });
            return;
          }
          if (err.code === 'NO_CLASSROOM_LOCATION' || err.code === 'GEOFENCE_NOT_CONFIGURED') {
            renderFinalFailure(
              extractFailureFromResultOrError(err.code, err.message, err.data, fixToVerify.accuracy),
              fixToVerify
            );
            return;
          }

          retriableFailure = extractFailureFromResultOrError(
            err.code,
            err.message || 'Location verification failed.',
            err.data,
            fixToVerify.accuracy
          );
        } else {
          retriableFailure = {
            code: 'NETWORK_OR_UNKNOWN',
            message: err?.message || 'Could not verify GPS position. Tap retry.',
            accuracyM: fixToVerify.accuracy,
          };
        }
      } finally {
        verificationInFlight = false;
      }

      if (cancelled || !isMountedRef.current) return;

      if (retriableFailure) {
        lastFailure = retriableFailure;
      }

      const elapsedMs = Date.now() - startTime;
      const windowStillOpen =
        !searchWindowClosed && !isFinalAttempt && elapsedMs < MAX_ACQUISITION_WINDOW_MS;

      if (windowStillOpen) {
        if (pendingVerifyFix && hasSignificantImprovement(pendingVerifyFix, lastVerifiedFix)) {
          const nextFix = pendingVerifyFix;
          pendingVerifyFix = null;
          void verifyFixWithBackend(nextFix, false);
          return;
        }
        pendingVerifyFix = null;

        const remainingSec = Math.max(1, Math.ceil((MAX_ACQUISITION_WINDOW_MS - elapsedMs) / 1000));
        if (lastFailure?.code === 'OUTSIDE_CLASSROOM_BOUNDARY' && lastFailure.distanceM !== undefined) {
          setGpsProgressStep(
            `Initial fix ${lastFailure.distanceM.toFixed(1)}m away (±${fixToVerify.accuracy.toFixed(0)}m) — refining satellite lock (${remainingSec}s)...`
          );
        } else if (lastFailure?.code === 'LOW_ACCURACY') {
          setGpsProgressStep(
            `Signal accuracy ±${fixToVerify.accuracy.toFixed(0)}m — waiting for tighter satellite lock (${remainingSec}s)...`
          );
        } else {
          setGpsProgressStep(`Refining GNSS satellite cluster (${remainingSec}s)...`);
        }
        return;
      }

      // Acquisition window closed: verify one last improved clustered fix if available
      const finalCandidate = pendingVerifyFix || bestClusteredFix;
      pendingVerifyFix = null;
      if (
        !isFinalAttempt &&
        finalCandidate &&
        finalCandidate.accuracy <= MAX_ALLOWED_ACCURACY_M &&
        hasSignificantImprovement(finalCandidate, lastVerifiedFix)
      ) {
        await verifyFixWithBackend(finalCandidate, true);
        return;
      }

      renderFinalFailure(lastFailure, bestClusteredFix || fixToVerify);
    };

    // 1. Settle window timer (3.5s): verifies inverse-variance weighted cluster ONLY if accuracy <= 65m
    settleTimer = setTimeout(() => {
      if (cancelled || !isMountedRef.current) return;
      settleWindowElapsed = true;
      if (
        bestClusteredFix &&
        bestClusteredFix.accuracy <= MAX_ALLOWED_ACCURACY_M &&
        !lastVerifiedFix &&
        !verificationInFlight
      ) {
        void verifyFixWithBackend(bestClusteredFix, false);
      } else if (!bestClusteredFix && bestRejectedAccuracyM !== null) {
        const remainingSec = Math.max(
          1,
          Math.ceil((MAX_ACQUISITION_WINDOW_MS - (Date.now() - startTime)) / 1000)
        );
        setGpsProgressStep(
          `GPS signal is ±${Math.round(bestRejectedAccuracyM)}m — waiting for ±${MAX_ALLOWED_ACCURACY_M}m or better (${remainingSec}s)...`
        );
      }
    }, SETTLE_WINDOW_MS);

    // 2. Maximum acquisition window timer (15s): runs Issue 5 10s retry if 60 < accuracy <= 120, or verifies/fails
    searchWindowTimer = setTimeout(() => {
      if (cancelled || !isMountedRef.current) return;
      searchWindowClosed = true;

      if (verificationInFlight) {
        return;
      }

      if (
        bestClusteredFix &&
        bestClusteredFix.accuracy > ACCURACY_RETRY_THRESHOLD_M &&
        bestClusteredFix.accuracy <= MAX_ALLOWED_ACCURACY_M &&
        !hasRunAccuracyRetry
      ) {
        hasRunAccuracyRetry = true;
        const initialFix = bestClusteredFix;
        if (watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
          watchId = null;
        }
        setGpsProgressStep(
          `Signal ±${Math.round(initialFix.accuracy)}m — running 10s precision retry...`
        );
        void acquirePreciseLocation({
          timeoutMs: ACCURACY_RETRY_TIMEOUT_MS,
          maxAllowedAccuracyM: MAX_ALLOWED_ACCURACY_M,
          onProgress: (p) => {
            if (!cancelled && isMountedRef.current) {
              setLiveAccuracy(p.accuracy);
              setGpsProgressStep(p.step);
            }
          },
        })
          .then((retryFix) => {
            if (cancelled || !isMountedRef.current) return;
            const betterFix = retryFix.accuracy < initialFix.accuracy ? retryFix : initialFix;
            bestClusteredFix = betterFix;
            void verifyFixWithBackend(betterFix, true);
          })
          .catch(() => {
            if (cancelled || !isMountedRef.current) return;
            if (lastFailure) {
              renderFinalFailure(lastFailure, initialFix);
            } else {
              void verifyFixWithBackend(initialFix, true);
            }
          });
        return;
      }

      if (
        bestClusteredFix &&
        bestClusteredFix.accuracy <= MAX_ALLOWED_ACCURACY_M &&
        hasSignificantImprovement(bestClusteredFix, lastVerifiedFix)
      ) {
        void verifyFixWithBackend(bestClusteredFix, true);
      } else if (lastFailure) {
        renderFinalFailure(lastFailure, bestClusteredFix);
      } else if (bestClusteredFix && bestClusteredFix.accuracy <= MAX_ALLOWED_ACCURACY_M) {
        void verifyFixWithBackend(bestClusteredFix, true);
      } else if (bestRejectedAccuracyM !== null) {
        renderFinalFailure(
          {
            code: 'LOW_ACCURACY',
            message: formatLowAccuracyMessage(bestRejectedAccuracyM, MAX_ALLOWED_ACCURACY_M),
            accuracyM: bestRejectedAccuracyM,
          },
          null
        );
      } else if (sawInvalidFix) {
        renderFinalFailure(
          {
            code: 'SUSPICIOUS_GPS',
            message:
              'Invalid or spoofed GPS readings detected. Disable any mock location apps, turn on Precise Location, and tap High-Precision GPS Retry.',
            accuracyM: 0,
          },
          null
        );
      } else if (sawStaleFix) {
        renderFinalFailure(
          {
            code: 'STALE_LOCATION',
            message:
              'Your phone only reported a cached old location (> 60s old). Toggle Location off and on, move near a window, and tap High-Precision GPS Retry.',
            accuracyM: 0,
          },
          null
        );
      } else {
        renderFinalFailure(
          {
            code: 'TIMEOUT',
            message:
              'GPS satellite lock timed out. Move near a window or turn on Precise Location & Wi-Fi scanning, then tap High-Precision GPS Retry.',
            accuracyM: 0,
          },
          null
        );
      }
    }, MAX_ACQUISITION_WINDOW_MS);

    const handlePosition = (pos: GeolocationPosition) => {
      if (cancelled || !isMountedRef.current) return;

      const now = Date.now();
      const currentFix: GpsFix = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: normalizeGpsTimestamp(pos.timestamp, now),
        receivedAt: now,
      };

      const validation = validateGpsFix(currentFix, now, MAX_ALLOWED_ACCURACY_M);
      if (!validation.valid) {
        const remainingSec = Math.max(
          1,
          Math.ceil((MAX_ACQUISITION_WINDOW_MS - (now - startTime)) / 1000)
        );
        if (validation.reason === 'COARSE_ACCURACY') {
          setLiveAccuracy(currentFix.accuracy);
          if (bestRejectedAccuracyM === null || currentFix.accuracy < bestRejectedAccuracyM) {
            bestRejectedAccuracyM = currentFix.accuracy;
          }
          setGpsProgressStep(
            `GPS signal is ±${Math.round(currentFix.accuracy)}m — must be ±${MAX_ALLOWED_ACCURACY_M}m or better (${remainingSec}s)...`
          );
        } else if (validation.reason === 'STALE_FIX' || validation.reason === 'FUTURE_TIMESTAMP') {
          sawStaleFix = true;
          setGpsProgressStep(
            `Discarded cached OS location — waking live GPS satellites (${remainingSec}s)...`
          );
        } else {
          sawInvalidFix = true;
          setGpsProgressStep(
            `Rejected invalid GPS reading — waiting for genuine satellite signal (${remainingSec}s)...`
          );
        }
        return;
      }

      // Deduplicate identical hardware reading delivered simultaneously by getCurrentPosition + watchPosition
      if (
        lastAcceptedFix &&
        currentFix.timestamp === lastAcceptedFix.timestamp &&
        currentFix.latitude === lastAcceptedFix.latitude &&
        currentFix.longitude === lastAcceptedFix.longitude &&
        currentFix.accuracy === lastAcceptedFix.accuracy
      ) {
        return;
      }

      // Anti-spoof check: detect impossible teleportation jump between consecutive high-accuracy fixes
      if (lastAcceptedFix) {
        const teleport = detectTeleportationJump(lastAcceptedFix, currentFix);
        if (teleport.isTeleport) {
          validSamples.length = 0;
          bestClusteredFix = null;
          renderFinalFailure(
            {
              code: 'GPS_TELEPORT_DETECTED',
              message: `Suspicious GPS location jump detected (${Math.round(teleport.distanceM)}m in ${(teleport.dtMs / 1000).toFixed(1)}s). Disable any mock location / spoofing apps, stay still, and tap High-Precision GPS Retry.`,
              accuracyM: currentFix.accuracy,
            },
            null
          );
          return;
        }
      }

      lastAcceptedFix = currentFix;
      validSamples.push(currentFix);

      // Retain recent fresh samples (max 12, and drop anything received more than 15s ago)
      while (
        validSamples.length > 12 ||
        (validSamples.length > 1 && now - (validSamples[0].receivedAt ?? validSamples[0].timestamp) > 15_000)
      ) {
        validSamples.shift();
      }

      const clustered = selectConsistentClusterAndAverage(validSamples, MAX_ALLOWED_ACCURACY_M);
      if (!clustered) return;

      if (
        !bestClusteredFix ||
        clustered.accuracy < bestClusteredFix.accuracy ||
        (clustered.sampleCount > bestClusteredFix.sampleCount &&
          clustered.accuracy <= bestClusteredFix.accuracy + 3)
      ) {
        bestClusteredFix = clustered;
      }

      setLiveAccuracy(clustered.accuracy);
      setLiveSampleCount(clustered.sampleCount);

      // CASE A: Confirmed multi-sample satellite lock (<= 20m, >= 2 consistent samples, <= 25m spread)
      if (
        clustered.sampleCount >= MIN_CONSISTENT_SAMPLES_FAST_LOCK &&
        clustered.accuracy <= TARGET_HIGH_ACCURACY_M &&
        clustered.spreadM <= MAX_FAST_LOCK_SPREAD_M
      ) {
        if (hasSignificantImprovement(clustered, lastVerifiedFix)) {
          void verifyFixWithBackend(clustered, false);
          return;
        }
      }

      // CASE B: Still in initial settling window -> collect additional GNSS samples for weighted averaging
      if (!settleWindowElapsed && !lastVerifiedFix) {
        setGpsProgressStep(
          `Confirming satellite cluster (±${clustered.accuracy.toFixed(1)}m · ${clustered.sampleCount} sample${clustered.sampleCount === 1 ? '' : 's'})...`
        );
        return;
      }

      // CASE C: After settling window (or refining after early failure) -> re-verify on meaningful improvement
      if (hasSignificantImprovement(clustered, lastVerifiedFix)) {
        void verifyFixWithBackend(clustered, false);
      }
    };

    const handleGeoError = (geoErr: GeolocationPositionError) => {
      if (cancelled || !isMountedRef.current) return;

      // Permission denied (code 1) is immediately terminal
      if (geoErr?.code === 1) {
        cleanup();
        setVerifiedSuccess(false);
        setErrorStatus(
          'Location permission was denied. Please allow Precise Location access in your browser or phone settings and tap retry.'
        );
        setLoading(false);
        return;
      }

      // For transient position unavailable (2) or timeout (3), only abort if acquisition window closed with no valid cluster
      if (searchWindowClosed && !bestClusteredFix) {
        cleanup();
        setVerifiedSuccess(false);
        setErrorStatus(
          bestRejectedAccuracyM !== null
            ? formatLowAccuracyMessage(bestRejectedAccuracyM, MAX_ALLOWED_ACCURACY_M)
            : geoErr?.code === 2
            ? 'GPS signal unavailable indoors. Move near a window or turn on Precise Location & Wi-Fi scanning, then retry.'
            : 'GPS satellite lock timed out. Move near a window and tap High-Precision GPS Retry.'
        );
        setLoading(false);
      }
    };

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: MAX_ACQUISITION_WINDOW_MS,
    };

    // 3. Fire getCurrentPosition in parallel with watchPosition to force an immediate A-GPS hardware poll on iOS WebKit & Android Chrome
    try {
      if (typeof navigator.geolocation.getCurrentPosition === 'function') {
        try {
          navigator.geolocation.getCurrentPosition(handlePosition, handleGeoError, geoOptions);
        } catch {
          // Ignore synchronous getCurrentPosition errors; watchPosition handles primary stream
        }
      }
      watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, geoOptions);
    } catch (e: any) {
      cleanup();
      setVerifiedSuccess(false);
      setErrorStatus(e?.message || 'Could not start GPS receiver. Tap retry.');
      setLoading(false);
    }
  }, [navigate, stopActiveGpsWatch]);

  // Step Guard: Identity must be completed
  useEffect(() => {
    isMountedRef.current = true;
    const currentAttempt = getAttemptState();

    if (!currentAttempt || !currentAttempt.attempt_id || !currentAttempt.attempt_token) {
      clearAttemptState();
      navigate('/', { replace: true });
      return;
    }

    if (!currentAttempt.student) {
      navigate('/attend/identity', { replace: true });
      return;
    }

    if (currentAttempt.session?.location_enabled !== true) {
      navigate('/attend/selfie', { replace: true });
      return;
    }

    requestLocation();

    return () => {
      isMountedRef.current = false;
      stopActiveGpsWatch();
    };
  }, [navigate, requestLocation, stopActiveGpsWatch]);

  const handleProceed = () => {
    if (!verifiedSuccess) return;
    if (!isLocationRequirementSatisfied(getAttemptState())) {
      setVerifiedSuccess(false);
      setErrorStatus('Classroom location verification is required before continuing.');
      return;
    }
    navigate('/attend/selfie');
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center overflow-x-hidden">
      {/* Header with Step 2 (Location) — Fixes QA-15 */}
      <Header
        currentStep="location"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-3 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col min-w-0">
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm border border-slate-200/80 mb-3 sm:mb-4 text-center min-w-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-50 border border-blue-200/80 text-[#1E40AF] flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <MapPin className="w-7 h-7 sm:w-8 sm:h-8 text-[#1E40AF]" />
          </div>

          <h2 className="text-base font-bold text-slate-900 tracking-tight mb-1">
            Lecture Hall Location
          </h2>
          <p className="text-xs text-slate-500 mb-4 sm:mb-6">
            Confirming your physical presence in the lecture hall
          </p>

          {/* Loading status */}
          {loading && (
            <div className="py-5 sm:py-6 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-[#1E40AF] animate-spin" />
              <p className="text-xs font-semibold text-slate-700">
                {liveAccuracy !== null
                  ? `Acquiring GPS fix (±${liveAccuracy.toFixed(1)}m${liveSampleCount > 0 ? ` · ${liveSampleCount} GNSS` : ''})...`
                  : 'Acquiring high-accuracy satellite GPS...'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                {gpsProgressStep}
              </p>
              <p className="text-[10px] text-slate-400">
                Hold phone steady near a window with Precise Location enabled
              </p>
            </div>
          )}

          {/* Error Banner with Measured Distance vs Allowed Radius & One-Tap High-Precision Retry */}
          {!loading && errorStatus && (
            <div className="mb-4 sm:mb-5 p-3.5 sm:p-4 bg-red-50 border border-red-200 rounded-xl sm:rounded-2xl text-left flex flex-col gap-3 text-xs text-red-800">
              <div className="flex items-start gap-2.5 sm:gap-3">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold break-words leading-snug">{errorStatus}</p>
                </div>
              </div>

              {boundaryMetrics &&
                (boundaryMetrics.distanceM !== undefined ||
                  boundaryMetrics.allowedRadiusM !== undefined ||
                  boundaryMetrics.accuracyM !== undefined) && (
                  <div className="bg-white/90 border border-red-200/80 rounded-xl p-2.5 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <span className="block text-[10px] uppercase font-semibold text-slate-400">
                        Measured
                      </span>
                      <span className="font-mono font-bold text-red-700 text-xs">
                        {boundaryMetrics.distanceM !== undefined
                          ? `${boundaryMetrics.distanceM.toFixed(1)}m`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-semibold text-slate-400">
                        Max Radius
                      </span>
                      <span className="font-mono font-bold text-slate-800 text-xs">
                        {boundaryMetrics.allowedRadiusM !== undefined
                          ? `${boundaryMetrics.allowedRadiusM}m`
                          : '50m'}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-semibold text-slate-400">
                        GPS Signal
                      </span>
                      <span className="font-mono font-bold text-slate-700 text-xs">
                        {boundaryMetrics.accuracyM !== undefined && boundaryMetrics.accuracyM > 0
                          ? `±${boundaryMetrics.accuracyM.toFixed(1)}m`
                          : '—'}
                      </span>
                    </div>
                  </div>
                )}

              <button
                type="button"
                onClick={requestLocation}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-1.5 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white text-xs font-bold py-2.5 px-3.5 rounded-xl shadow-xs transition-all active:scale-[0.99]"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>High-Precision GPS Retry</span>
              </button>

              <details className="bg-white/90 border border-red-200/80 rounded-xl p-2.5 text-left group">
                <summary className="cursor-pointer list-none flex items-center justify-between text-[11px] font-bold text-slate-800 select-none">
                  <span>Troubleshooting: Precise Location</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="mt-2 space-y-1.5 text-[11px] text-slate-700 leading-snug">
                  <li>
                    <strong className="text-slate-900">iOS Safari:</strong> Settings → Privacy &amp; Security → Location Services → Safari Websites → Precise Location ON
                  </li>
                  <li>
                    <strong className="text-slate-900">Chrome on iOS:</strong> Settings → Privacy &amp; Security → Location Services → Chrome → Precise Location ON
                  </li>
                  <li>
                    <strong className="text-slate-900">Android Chrome:</strong> Tap the address-bar lock/tune icon → Permissions → Location → Precise
                  </li>
                </ul>
              </details>
            </div>
          )}

          {/* Success card */}
          {!loading && verifiedSuccess && coords && (
            <div className="space-y-3 sm:space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                </div>
                <div className="text-sm font-extrabold text-emerald-950">
                  Location Verified!
                </div>
                <div className="text-xs text-emerald-800 mt-0.5 break-words">
                  {boundaryStatus || 'Classroom Geofence Confirmed'}
                </div>
                <div className="mt-3 pt-2 border-t border-emerald-200/60 text-[11px] text-emerald-800/80 font-mono">
                  GPS Accuracy: ±{coords.accuracy.toFixed(1)}m
                  {coords.sampleCount && coords.sampleCount > 1
                    ? ` (${coords.sampleCount} GNSS samples)`
                    : ''}
                </div>
              </div>

              <button
                type="button"
                onClick={handleProceed}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-all active:scale-[0.99]"
              >
                <span>Continue to Selfie Verification</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Security footer */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5 mt-auto pb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1E40AF]" />
          <span>ADUN Anti-Spoof Location Verification</span>
        </div>
      </div>
    </div>
  );
};
