/**
 * High-Precision GNSS Satellite Acquisition & Anti-Spoof Engine
 *
 * Uses navigator.geolocation.watchPosition with { enableHighAccuracy: true, maximumAge: 0 }
 * to actively wake up the device's hardware GNSS receiver, discard stale OS-cached fixes,
 * reject coarse cell/Wi-Fi guesses (> 65m) and mock-GPS anomalies, detect impossible
 * teleportation jumps, select the sharpest consistent GNSS cluster, and compute an
 * inverse-variance weighted average coordinate before backend boundary verification.
 */

export const MAX_ALLOWED_ACCURACY_M = 65;
export const TARGET_HIGH_ACCURACY_M = 20;
export const MAX_FIX_AGE_MS = 60_000;
export const MAX_FUTURE_SKEW_MS = 15_000;
export const TELEPORT_DISTANCE_M = 100;
export const TELEPORT_WINDOW_MS = 2_000;
export const MAX_PLAUSIBLE_SPEED_MPS = 50;
export const SETTLE_WINDOW_MS = 3_500;
export const MAX_ACQUISITION_WINDOW_MS = 12_000;
export const MIN_CONSISTENT_SAMPLES_FAST_LOCK = 2;
export const MAX_FAST_LOCK_SPREAD_M = 25;

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  receivedAt?: number;
}

export interface PreciseLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  sampleCount: number;
  spreadM: number;
  timestamp: number;
}

export type GpsRejectionReason =
  | 'INVALID_COORDINATES'
  | 'NULL_ISLAND'
  | 'INVALID_ACCURACY'
  | 'STALE_FIX'
  | 'FUTURE_TIMESTAMP'
  | 'COARSE_ACCURACY';

export interface GpsValidationResult {
  valid: boolean;
  reason?: GpsRejectionReason;
  ageMs?: number;
  accuracy?: number;
}

export interface TeleportCheckResult {
  isTeleport: boolean;
  distanceM: number;
  dtMs: number;
  impliedSpeedMps: number;
}

export interface AcquireLocationOptions {
  timeoutMs?: number;
  settleWindowMs?: number;
  targetAccuracyM?: number;
  maxAllowedAccuracyM?: number;
  onProgress?: (progress: { accuracy: number; step: string; sampleCount: number }) => void;
}

/**
 * Authoritative session location check resolver.
 * Strictly trusts the server's validate-session-token response (`location_enabled === true`).
 * Never allows client URL query parameters (e.g. `?loc=0`) to override server enforcement.
 */
export function resolveLocationEnabled(serverLocationEnabled: unknown): boolean {
  return serverLocationEnabled === true;
}

/**
 * Great-circle Haversine distance in meters between two WGS-84 coordinates.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const clampedA = Math.min(1, Math.max(0, a));
  return 2 * R * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

/**
 * Normalizes a GeolocationPosition.timestamp across mobile WebKit/Chromium quirks.
 * Preserves valid Unix epoch timestamps (in ms) so validateGpsFix can detect stale fixes,
 * while normalizing missing, zero, or monotonic boot-clock timestamps (< 1e12) to `nowMs`.
 */
export function normalizeGpsTimestamp(rawTimestamp: unknown, nowMs: number = Date.now()): number {
  if (typeof rawTimestamp !== 'number' || !Number.isFinite(rawTimestamp) || rawTimestamp <= 0) {
    return nowMs;
  }
  // Monotonic performance/boot timer values (< ~2001-09-09 in Unix epoch ms) are not wall-clock epochs
  if (rawTimestamp < 1_000_000_000_000) {
    return nowMs;
  }
  return rawTimestamp;
}

/**
 * Validates a single GNSS reading for coordinate integrity, anti-spoof artifacts,
 * freshness (<= 60s to support stationary lecture hall hardware fixes), and strict
 * classroom accuracy ceiling (<= 65m).
 */
export function validateGpsFix(
  fix: GpsFix,
  nowMs: number = Date.now(),
  maxAllowedAccuracyM: number = MAX_ALLOWED_ACCURACY_M
): GpsValidationResult {
  if (
    !fix ||
    !Number.isFinite(fix.latitude) ||
    !Number.isFinite(fix.longitude) ||
    fix.latitude < -90 ||
    fix.latitude > 90 ||
    fix.longitude < -180 ||
    fix.longitude > 180
  ) {
    return { valid: false, reason: 'INVALID_COORDINATES' };
  }

  // Reject (0, 0) Null Island (within ~11m of 0°, 0°) — common mock/uninitialized GPS artifact
  if (Math.abs(fix.latitude) < 0.0001 && Math.abs(fix.longitude) < 0.0001) {
    return { valid: false, reason: 'NULL_ISLAND' };
  }

  // Reject missing, non-finite, zero, or negative accuracy — classic mock-GPS spoofing tell
  if (!Number.isFinite(fix.accuracy) || fix.accuracy <= 0) {
    return { valid: false, reason: 'INVALID_ACCURACY', accuracy: fix.accuracy };
  }

  // Validate freshness: discard stale cached OS fixes older than 60 seconds or future-forged timestamps (> 15s skew)
  if (!Number.isFinite(fix.timestamp) || fix.timestamp <= 0) {
    return { valid: false, reason: 'STALE_FIX' };
  }
  const ageMs = nowMs - fix.timestamp;
  if (ageMs > MAX_FIX_AGE_MS) {
    return { valid: false, reason: 'STALE_FIX', ageMs, accuracy: fix.accuracy };
  }
  if (ageMs < -MAX_FUTURE_SKEW_MS) {
    return { valid: false, reason: 'FUTURE_TIMESTAMP', ageMs, accuracy: fix.accuracy };
  }

  // Reject coarse cell-tower / IP / wide Wi-Fi fixes that cannot reliably verify a 50m hall
  if (fix.accuracy > maxAllowedAccuracyM) {
    return { valid: false, reason: 'COARSE_ACCURACY', ageMs, accuracy: fix.accuracy };
  }

  return { valid: true, ageMs, accuracy: fix.accuracy };
}

/**
 * Detects impossible teleportation jumps between two consecutive high-accuracy GNSS fixes
 * (e.g., > 100m in < 2s or implied speed > 50 m/s = 180 km/h over > 100m).
 */
export function detectTeleportationJump(prevFix: GpsFix, nextFix: GpsFix): TeleportCheckResult {
  const distanceM = haversineDistanceMeters(
    prevFix.latitude,
    prevFix.longitude,
    nextFix.latitude,
    nextFix.longitude
  );

  const tsDeltaMs = Math.abs(nextFix.timestamp - prevFix.timestamp);
  const rxDeltaMs =
    prevFix.receivedAt !== undefined && nextFix.receivedAt !== undefined
      ? Math.abs(nextFix.receivedAt - prevFix.receivedAt)
      : tsDeltaMs;
  const dtMs = Math.min(tsDeltaMs, rxDeltaMs);

  const dtSec = dtMs / 1000;
  const impliedSpeedMps = dtSec > 0 ? distanceM / dtSec : distanceM > 0 ? Infinity : 0;

  const isTeleport =
    distanceM > TELEPORT_DISTANCE_M &&
    (dtMs < TELEPORT_WINDOW_MS || impliedSpeedMps > MAX_PLAUSIBLE_SPEED_MPS);

  return {
    isTeleport,
    distanceM,
    dtMs,
    impliedSpeedMps,
  };
}

/**
 * Selects the sharpest consistent GNSS cluster from valid fresh samples (filtering out
 * single-sample drift outliers) and computes an inverse-variance weighted average
 * (w_i = 1 / sigma_i^2).
 */
export function selectConsistentClusterAndAverage(
  samples: GpsFix[],
  maxAllowedAccuracyM: number = MAX_ALLOWED_ACCURACY_M
): PreciseLocation | null {
  if (!samples || samples.length === 0) return null;

  if (samples.length === 1) {
    const only = samples[0];
    if (only.accuracy > maxAllowedAccuracyM) return null;
    return {
      latitude: only.latitude,
      longitude: only.longitude,
      accuracy: only.accuracy,
      sampleCount: 1,
      spreadM: 0,
      timestamp: only.timestamp,
    };
  }

  // Find the consistent neighbor cluster with the highest cumulative inverse-variance weight
  let bestCluster: GpsFix[] = [];
  let bestClusterWeight = -1;

  for (let i = 0; i < samples.length; i++) {
    const anchor = samples[i];
    const cluster: GpsFix[] = [];
    let clusterWeight = 0;

    for (let j = 0; j < samples.length; j++) {
      const candidate = samples[j];
      const dist = haversineDistanceMeters(
        anchor.latitude,
        anchor.longitude,
        candidate.latitude,
        candidate.longitude
      );
      const maxPairDist = Math.max(
        25,
        Math.min(maxAllowedAccuracyM, (anchor.accuracy + candidate.accuracy) * 0.85)
      );
      if (dist <= maxPairDist) {
        cluster.push(candidate);
        const sigma = Math.max(candidate.accuracy, 1);
        clusterWeight += 1 / (sigma * sigma);
      }
    }

    if (
      clusterWeight > bestClusterWeight ||
      (clusterWeight === bestClusterWeight && cluster.length > bestCluster.length)
    ) {
      bestCluster = cluster;
      bestClusterWeight = clusterWeight;
    }
  }

  if (bestCluster.length === 0) {
    bestCluster = [samples[samples.length - 1]];
  }

  // Inverse-variance weighted centroid: w_i = 1 / sigma_i^2
  let sumWeights = 0;
  let weightedLat = 0;
  let weightedLng = 0;
  let weightedAcc = 0;
  let latestTimestamp = 0;

  for (const s of bestCluster) {
    const sigma = Math.max(s.accuracy, 1);
    const w = 1 / (sigma * sigma);
    sumWeights += w;
    weightedLat += w * s.latitude;
    weightedLng += w * s.longitude;
    weightedAcc += w * s.accuracy;
    if (s.timestamp > latestTimestamp) {
      latestTimestamp = s.timestamp;
    }
  }

  const avgLat = weightedLat / sumWeights;
  const avgLng = weightedLng / sumWeights;
  const avgAccuracy = weightedAcc / sumWeights;

  // Measure physical cluster scatter around weighted centroid so we never understate true error
  let maxSpreadM = 0;
  for (const s of bestCluster) {
    const d = haversineDistanceMeters(avgLat, avgLng, s.latitude, s.longitude);
    if (d > maxSpreadM) {
      maxSpreadM = d;
    }
  }

  const conservativeAccuracy = Math.max(avgAccuracy, maxSpreadM);
  if (conservativeAccuracy > maxAllowedAccuracyM) {
    return null;
  }

  return {
    latitude: avgLat,
    longitude: avgLng,
    accuracy: conservativeAccuracy,
    sampleCount: bestCluster.length,
    spreadM: maxSpreadM,
    timestamp: latestTimestamp,
  };
}

/**
 * Clear student-facing message when phone GNSS cannot meet the <= 65m classroom accuracy gate.
 * Includes tailored OS/browser instructions when accuracy >= 500m (e.g. ±1414m Approximate Location).
 */
export function formatLowAccuracyMessage(
  measuredAccuracyM?: number | null,
  maxAllowedAccuracyM: number = MAX_ALLOWED_ACCURACY_M
): string {
  const hasValidAcc =
    measuredAccuracyM !== undefined &&
    measuredAccuracyM !== null &&
    Number.isFinite(measuredAccuracyM) &&
    measuredAccuracyM > 0;
  const accLabel = hasValidAcc ? `±${Math.round(measuredAccuracyM!)}m` : 'too coarse';

  if (hasValidAcc && measuredAccuracyM! >= 500) {
    return `GPS signal accuracy is ${accLabel} — must be ±${maxAllowedAccuracyM}m or better to verify inside this hall. Enable Precise Location in your browser/OS settings (iOS: Settings → Privacy & Security → Location Services → Safari Websites → Precise Location ON; Android: tap the address-bar lock/tune icon → Permissions → Location → Precise), move near a window, then retry.`;
  }

  return `GPS signal accuracy is ${accLabel} — must be ±${maxAllowedAccuracyM}m or better to verify inside this hall. Move near a window or turn on Precise Location & Wi-Fi scanning, then retry.`;
}

/**
 * Standalone Promise-based high-precision GNSS acquisition helper.
 * Collects fresh, non-spoofed GNSS readings via watchPosition and resolves with the
 * inverse-variance weighted cluster average, or rejects if accuracy > 65m or spoofing is detected.
 */
export function acquirePreciseLocation(options: AcquireLocationOptions = {}): Promise<PreciseLocation> {
  const {
    timeoutMs = MAX_ACQUISITION_WINDOW_MS,
    settleWindowMs = SETTLE_WINDOW_MS,
    targetAccuracyM = TARGET_HIGH_ACCURACY_M,
    maxAllowedAccuracyM = MAX_ALLOWED_ACCURACY_M,
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by your mobile browser.');
      (err as any).code = 'UNSUPPORTED';
      return reject(err);
    }

    const validSamples: GpsFix[] = [];
    let lastAcceptedFix: GpsFix | null = null;
    let bestRejectedAccuracyM: number | null = null;
    let sawStaleOnly = false;
    let sawInvalidSpoof = false;
    let settled = false;
    let watchId: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const finishResolve = (loc: PreciseLocation) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(loc);
    };

    const finishReject = (message: string, code: string, accuracyM?: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error(message);
      (err as any).code = code;
      if (accuracyM !== undefined) {
        (err as any).accuracyM = accuracyM;
      }
      reject(err);
    };

    settleTimer = setTimeout(() => {
      if (settled) return;
      const clustered = selectConsistentClusterAndAverage(validSamples, maxAllowedAccuracyM);
      if (clustered && clustered.accuracy <= targetAccuracyM) {
        finishResolve(clustered);
      }
    }, settleWindowMs);

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      const clustered = selectConsistentClusterAndAverage(validSamples, maxAllowedAccuracyM);
      if (clustered && clustered.accuracy <= maxAllowedAccuracyM) {
        finishResolve(clustered);
        return;
      }
      if (bestRejectedAccuracyM !== null) {
        finishReject(
          formatLowAccuracyMessage(bestRejectedAccuracyM, maxAllowedAccuracyM),
          'LOW_ACCURACY',
          bestRejectedAccuracyM
        );
        return;
      }
      if (sawInvalidSpoof) {
        finishReject(
          'Invalid or spoofed GPS readings detected. Disable mock location apps and retry.',
          'SUSPICIOUS_GPS'
        );
        return;
      }
      if (sawStaleOnly) {
        finishReject(
          'Your device only returned an outdated cached GPS location. Toggle Location off and back on, then retry.',
          'STALE_LOCATION'
        );
        return;
      }
      finishReject(
        'GPS satellite acquisition timed out. Move near a window or turn on Precise Location & Wi-Fi scanning, then retry.',
        'TIMEOUT'
      );
    }, timeoutMs);

    const handlePosition = (pos: GeolocationPosition) => {
      if (settled) return;
      const now = Date.now();
      const fix: GpsFix = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: normalizeGpsTimestamp(pos.timestamp, now),
        receivedAt: now,
      };

      const validation = validateGpsFix(fix, now, maxAllowedAccuracyM);
      if (!validation.valid) {
        if (validation.reason === 'COARSE_ACCURACY') {
          if (bestRejectedAccuracyM === null || fix.accuracy < bestRejectedAccuracyM) {
            bestRejectedAccuracyM = fix.accuracy;
          }
          onProgress?.({
            accuracy: fix.accuracy,
            step: `Coarse signal (±${Math.round(fix.accuracy)}m) — waiting for ±${maxAllowedAccuracyM}m or better...`,
            sampleCount: validSamples.length,
          });
        } else if (validation.reason === 'STALE_FIX' || validation.reason === 'FUTURE_TIMESTAMP') {
          sawStaleOnly = true;
        } else {
          sawInvalidSpoof = true;
        }
        return;
      }

      // Deduplicate identical hardware reading delivered simultaneously by getCurrentPosition + watchPosition
      if (
        lastAcceptedFix &&
        fix.timestamp === lastAcceptedFix.timestamp &&
        fix.latitude === lastAcceptedFix.latitude &&
        fix.longitude === lastAcceptedFix.longitude &&
        fix.accuracy === lastAcceptedFix.accuracy
      ) {
        return;
      }

      if (lastAcceptedFix) {
        const teleport = detectTeleportationJump(lastAcceptedFix, fix);
        if (teleport.isTeleport) {
          finishReject(
            `Suspicious GPS jump detected (${Math.round(teleport.distanceM)}m in ${(teleport.dtMs / 1000).toFixed(1)}s). Disable any mock location apps, hold still, and retry.`,
            'GPS_TELEPORT_DETECTED',
            fix.accuracy
          );
          return;
        }
      }

      lastAcceptedFix = fix;
      validSamples.push(fix);
      if (validSamples.length > 12) {
        validSamples.shift();
      }

      const clustered = selectConsistentClusterAndAverage(validSamples, maxAllowedAccuracyM);
      if (!clustered) return;

      onProgress?.({
        accuracy: clustered.accuracy,
        step:
          clustered.accuracy <= targetAccuracyM && clustered.sampleCount >= MIN_CONSISTENT_SAMPLES_FAST_LOCK
            ? 'High-precision GNSS lock confirmed'
            : `Refining satellite lock (±${clustered.accuracy.toFixed(1)}m, ${clustered.sampleCount} sample${clustered.sampleCount === 1 ? '' : 's'})...`,
        sampleCount: clustered.sampleCount,
      });

      if (
        clustered.sampleCount >= MIN_CONSISTENT_SAMPLES_FAST_LOCK &&
        clustered.accuracy <= targetAccuracyM &&
        clustered.spreadM <= MAX_FAST_LOCK_SPREAD_M
      ) {
        finishResolve(clustered);
      }
    };

    const handleGeoError = (geoErr: GeolocationPositionError) => {
      if (settled) return;
      if (geoErr?.code === 1) {
        finishReject(
          'Location permission was denied. Please allow Precise Location access and retry.',
          'PERMISSION_DENIED'
        );
      }
    };

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: timeoutMs,
    };

    try {
      // Fire getCurrentPosition in parallel with watchPosition to force an immediate A-GPS hardware poll on iOS WebKit & Android Chrome
      if (typeof navigator.geolocation.getCurrentPosition === 'function') {
        try {
          navigator.geolocation.getCurrentPosition(handlePosition, handleGeoError, geoOptions);
        } catch {
          // Ignore synchronous getCurrentPosition errors; watchPosition handles primary stream
        }
      }
      watchId = navigator.geolocation.watchPosition(handlePosition, handleGeoError, geoOptions);
    } catch (e: any) {
      finishReject(e?.message || 'Could not start GPS receiver.', 'GPS_ERROR');
    }
  });
}
