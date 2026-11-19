import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, AlertTriangle, RefreshCw, ArrowRight, ShieldCheck } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptLocation, clearAttemptState } from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface BoundaryFailureDetails {
  code: string;
  message: string;
  distanceM?: number;
  allowedRadiusM?: number;
  accuracyM: number;
}

// Fast-path accuracy threshold: readings <= 20m are satellite-grade and verified immediately
const FAST_VERIFY_ACCURACY_M = 20;
// Settling window for moderate/coarse readings (> 20m) so initial Wi-Fi/cell bounce is replaced by GPS
const MODERATE_SETTLE_WINDOW_MS = 3500;
// Total active search window to continue listening and re-verifying if early samples return "too far"
const MAX_SEARCH_WINDOW_MS = 10000;

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const AttendLocationPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [boundaryMetrics, setBoundaryMetrics] = useState<{
    distanceM?: number;
    allowedRadiusM?: number;
    accuracyM?: number;
  } | null>(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);
  const [liveAccuracy, setLiveAccuracy] = useState<number | null>(null);
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
    if (!currentAttempt?.session?.location_enabled) {
      navigate('/attend/selfie', { replace: true });
      return;
    }

    if (!currentAttempt?.attempt_token) {
      clearAttemptState();
      navigate('/expired', { replace: true });
      return;
    }

    // Cancel any previous active watcher or timers
    stopActiveGpsWatch();

    setLoading(true);
    setErrorStatus(null);
    setBoundaryMetrics(null);
    setVerifiedSuccess(false);
    setBoundaryStatus(null);
    setLiveAccuracy(null);
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

    let bestFix: GpsFix | null = null;
    let lastVerifiedFix: GpsFix | null = null;
    let lastFailure: BoundaryFailureDetails | null = null;
    let verificationInFlight = false;
    let pendingVerifyFix: GpsFix | null = null;
    let settleWindowElapsed = false;
    let searchWindowClosed = false;
    let verifyAttemptsCount = 0;

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

    const renderFinalFailure = (failure: BoundaryFailureDetails | null, fallbackFix: GpsFix | null) => {
      if (!isMountedRef.current) return;
      cleanup();
      setVerifiedSuccess(false);

      const finalAcc = failure?.accuracyM ?? fallbackFix?.accuracy;
      if (fallbackFix) {
        setCoords({
          lat: fallbackFix.latitude,
          lng: fallbackFix.longitude,
          accuracy: fallbackFix.accuracy,
        });
      }

      if (failure) {
        if (failure.code === 'LOW_ACCURACY') {
          setBoundaryMetrics(
            finalAcc !== undefined ? { accuracyM: finalAcc } : null
          );
          setErrorStatus(
            `GPS accuracy (${finalAcc !== undefined ? `±${finalAcc.toFixed(1)}m` : 'coarse'}) is too low for classroom verification. Move closer to a window or open sky and tap High-Precision GPS Retry.`
          );
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
          setBoundaryMetrics(
            finalAcc !== undefined ? { accuracyM: finalAcc } : null
          );
          setErrorStatus('You are outside the permitted lecture hall / campus boundary.');
        } else if (failure.code === 'NO_CLASSROOM_LOCATION' || failure.code === 'GEOFENCE_NOT_CONFIGURED') {
          setErrorStatus(
            'This lecture session does not have a classroom location configured. Please notify your lecturer.'
          );
        } else {
          setErrorStatus(failure.message || 'Location could not be verified. Tap retry.');
        }
      } else {
        setErrorStatus('GPS satellite lock timed out before confirming classroom boundary. Move closer to a window and tap High-Precision GPS Retry.');
      }

      setLoading(false);
    };

    const hasSignificantImprovement = (candidate: GpsFix, previousVerified: GpsFix | null): boolean => {
      if (!previousVerified) return true;
      const accImprovedM = previousVerified.accuracy - candidate.accuracy;
      const accImprovedRatio = accImprovedM / Math.max(previousVerified.accuracy, 1);
      const coordShiftM = haversineDistanceMeters(
        previousVerified.latitude,
        previousVerified.longitude,
        candidate.latitude,
        candidate.longitude
      );
      // Re-verify if accuracy improved by >= 3m or >= 12%, or if coordinates converged by >= 3m with good accuracy
      return (
        accImprovedM >= 3 ||
        accImprovedRatio >= 0.12 ||
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

    const verifyFixWithBackend = async (fixToVerify: GpsFix, isFinalAttempt = false): Promise<void> => {
      if (cancelled || !isMountedRef.current) return;

      if (verificationInFlight) {
        if (!pendingVerifyFix || fixToVerify.accuracy <= pendingVerifyFix.accuracy) {
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
        });
        setGpsProgressStep(
          verifyAttemptsCount === 1
            ? `Verifying classroom boundary (±${fixToVerify.accuracy.toFixed(1)}m)...`
            : `Re-verifying converged satellite fix #${verifyAttemptsCount} (±${fixToVerify.accuracy.toFixed(1)}m)...`
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

        if (result.success) {
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
          });
          updateAttemptLocation({
            latitude: fixToVerify.latitude,
            longitude: fixToVerify.longitude,
            accuracy_m: fixToVerify.accuracy,
            verified_at: new Date().toISOString(),
            inside_boundary: result.inside_boundary,
          });
          setVerifiedSuccess(true);
          setLoading(false);
          return;
        }

        // Handle non-throwing result.success === false responses
        const errCode = result.error || 'LOCATION_VERIFICATION_FAILED';
        if (errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED') {
          cleanup();
          clearAttemptState();
          navigate('/expired', { replace: true });
          return;
        }
        if (errCode === 'SESSION_CLOSED') {
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
          // Only redirect to /closed on explicit SESSION_CLOSED (HTTP 403 is also used for OUTSIDE_CLASSROOM_BOUNDARY / OUTSIDE_CAMPUS_BOUNDARY / LOW_ACCURACY)
          if (err.code === 'SESSION_CLOSED') {
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
      const windowStillOpen = !searchWindowClosed && !isFinalAttempt && elapsedMs < MAX_SEARCH_WINDOW_MS;

      if (windowStillOpen) {
        // If a better fix arrived while verification was in flight, verify it immediately
        if (pendingVerifyFix && hasSignificantImprovement(pendingVerifyFix, lastVerifiedFix)) {
          const nextFix = pendingVerifyFix;
          pendingVerifyFix = null;
          void verifyFixWithBackend(nextFix, false);
          return;
        }
        pendingVerifyFix = null;

        // Keep watchPosition alive so tighter satellite fixes can converge inside the boundary
        const remainingSec = Math.max(1, Math.ceil((MAX_SEARCH_WINDOW_MS - elapsedMs) / 1000));
        if (lastFailure?.code === 'OUTSIDE_CLASSROOM_BOUNDARY' && lastFailure.distanceM !== undefined) {
          setGpsProgressStep(
            `Initial fix ${lastFailure.distanceM.toFixed(1)}m away (±${fixToVerify.accuracy.toFixed(0)}m) — refining satellite lock (${remainingSec}s)...`
          );
        } else if (lastFailure?.code === 'LOW_ACCURACY') {
          setGpsProgressStep(
            `Coarse signal (±${fixToVerify.accuracy.toFixed(0)}m) — waiting for tighter satellite lock (${remainingSec}s)...`
          );
        } else {
          setGpsProgressStep(`Refining GPS coordinates with satellite receiver (${remainingSec}s)...`);
        }
        return;
      }

      // Search window has closed: if there is an unverified better fix, try it once before failing
      const finalCandidate = pendingVerifyFix || bestFix;
      pendingVerifyFix = null;
      if (
        !isFinalAttempt &&
        finalCandidate &&
        hasSignificantImprovement(finalCandidate, lastVerifiedFix)
      ) {
        await verifyFixWithBackend(finalCandidate, true);
        return;
      }

      renderFinalFailure(lastFailure, bestFix || fixToVerify);
    };

    // 1. Settle window timer (3.5s): submits best moderate/coarse sample if no <= 20m sample arrived earlier
    settleTimer = setTimeout(() => {
      if (cancelled || !isMountedRef.current) return;
      settleWindowElapsed = true;
      if (bestFix && !lastVerifiedFix && !verificationInFlight) {
        void verifyFixWithBackend(bestFix, false);
      }
    }, MODERATE_SETTLE_WINDOW_MS);

    // 2. Maximum search window timer (10s): stops waiting and runs final verification on best sample or displays diagnostic error
    searchWindowTimer = setTimeout(() => {
      if (cancelled || !isMountedRef.current) return;
      searchWindowClosed = true;

      if (verificationInFlight) {
        // Let the in-flight verification complete; its post-check will see searchWindowClosed === true
        return;
      }

      if (bestFix && hasSignificantImprovement(bestFix, lastVerifiedFix)) {
        void verifyFixWithBackend(bestFix, true);
      } else if (lastFailure) {
        renderFinalFailure(lastFailure, bestFix);
      } else if (bestFix) {
        void verifyFixWithBackend(bestFix, true);
      } else {
        renderFinalFailure(
          {
            code: 'TIMEOUT',
            message: 'GPS satellite lock timed out. Please move near a window or open sky and tap High-Precision GPS Retry.',
            accuracyM: 0,
          },
          null
        );
      }
    }, MAX_SEARCH_WINDOW_MS);

    // 3. Start streaming high-accuracy hardware GPS fixes (maximumAge: 0 forbids stale cached OS fixes)
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled || !isMountedRef.current) return;

          const currentFix: GpsFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          };

          if (
            !bestFix ||
            currentFix.accuracy < bestFix.accuracy ||
            // Also prefer a newer reading if its accuracy is within 2m of bestFix after initial settle
            (currentFix.accuracy <= bestFix.accuracy + 2 && currentFix.accuracy <= 25)
          ) {
            bestFix = currentFix;
          }

          setLiveAccuracy(currentFix.accuracy);

          // CASE A: Very accurate satellite fix (<= 20m) -> verify immediately!
          if (currentFix.accuracy <= FAST_VERIFY_ACCURACY_M) {
            if (hasSignificantImprovement(currentFix, lastVerifiedFix)) {
              void verifyFixWithBackend(currentFix, false);
              return;
            }
          }

          // CASE B: Moderate/coarse reading (> 20m) before 3.5s settle window completes -> keep collecting samples
          if (!settleWindowElapsed && !lastVerifiedFix) {
            setGpsProgressStep(
              `Filtering initial signal (±${currentFix.accuracy.toFixed(1)}m), locking onto GPS satellites...`
            );
            return;
          }

          // CASE C: After 3.5s settle window (or after an early "too far" result while < 10s search window is open),
          // re-verify as soon as a significantly better reading arrives!
          if (hasSignificantImprovement(currentFix, lastVerifiedFix)) {
            void verifyFixWithBackend(currentFix, false);
          }
        },
        (geoErr) => {
          if (cancelled || !isMountedRef.current) return;

          // Permission denied (code 1) is immediately terminal
          if (geoErr?.code === 1) {
            cleanup();
            setVerifiedSuccess(false);
            setErrorStatus(
              'Location permission was denied. Please allow location access in your browser or phone settings and tap retry.'
            );
            setLoading(false);
            return;
          }

          // For transient position unavailable (2) or timeout (3), only abort if search window is closed and we have no fix
          if (searchWindowClosed && !bestFix) {
            cleanup();
            setVerifiedSuccess(false);
            setErrorStatus(
              geoErr?.code === 2
                ? 'GPS signal unavailable indoors. Move closer to open sky and tap High-Precision GPS Retry.'
                : 'GPS satellite lock timed out. Please tap High-Precision GPS Retry.'
            );
            setLoading(false);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12000,
        }
      );
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

    if (!currentAttempt.session?.location_enabled) {
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
                  ? `Acquiring GPS fix (±${liveAccuracy.toFixed(1)}m)...`
                  : 'Acquiring high-accuracy satellite GPS...'}
              </p>
              <p className="text-[11px] text-slate-500 font-medium">
                {gpsProgressStep}
              </p>
              <p className="text-[10px] text-slate-400">
                Hold phone steady near a window or clear view
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
