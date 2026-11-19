/**
 * High-Precision GPS Satellite Acquisition
 *
 * Uses navigator.geolocation.watchPosition with { enableHighAccuracy: true, maximumAge: 0 }
 * to actively wake up the device's hardware GNSS receiver, discard stale cached positions,
 * reject spatial/coarse outliers, and compute an inverse-variance (1/accuracy^2) weighted
 * centroid over the tightest cluster of satellite fixes.
 */

export interface PreciseLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  sampleCount: number;
  clusteredSamples?: number;
}

export interface AcquireLocationOptions {
  timeoutMs?: number;
  targetAccuracyM?: number;
  minSampleMs?: number;
  maxStaleAgeMs?: number;
  onProgress?: (progress: {
    accuracy: number;
    bestAccuracy: number;
    sampleCount: number;
    step: string;
  }) => void;
}

interface LocationSample {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

const EARTH_RADIUS_M = 6371000;

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Computes an inverse-variance (1/accuracy^2) weighted centroid from the tightest
 * spatially consistent cluster of GPS samples:
 *  - Keeps samples within 1.5x of the best observed accuracy
 *  - Rejects spatial outliers further than 25m from the single most accurate reading
 *  - Preserves the best observed accuracy (without artificially shrinking correlated Wi-Fi bias)
 */
function computeWeightedLocation(samples: LocationSample[]): PreciseLocation {
  const sorted = [...samples].sort((a, b) => a.accuracy - b.accuracy);
  const best = sorted[0];
  const accuracyCeiling = best.accuracy * 1.5;

  const cluster = sorted.filter(
    (s) =>
      s.accuracy <= accuracyCeiling &&
      haversineDistanceM(s.latitude, s.longitude, best.latitude, best.longitude) <= 25
  );

  const activeCluster = cluster.length > 0 ? cluster : [best];

  let weightedLatSum = 0;
  let weightedLngSum = 0;
  let weightSum = 0;

  for (const s of activeCluster) {
    const safeAcc = Math.max(s.accuracy, 1);
    const weight = 1 / (safeAcc * safeAcc);
    weightedLatSum += s.latitude * weight;
    weightedLngSum += s.longitude * weight;
    weightSum += weight;
  }

  return {
    latitude: weightedLatSum / weightSum,
    longitude: weightedLngSum / weightSum,
    accuracy: best.accuracy,
    sampleCount: samples.length,
    clusteredSamples: activeCluster.length,
  };
}

export function acquirePreciseLocation(options: AcquireLocationOptions = {}): Promise<PreciseLocation> {
  const {
    timeoutMs = 10000,
    targetAccuracyM = 15,
    minSampleMs = 2000,
    maxStaleAgeMs = 10000,
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by your browser.');
      (err as any).code = 2;
      return reject(err);
    }

    const startTime = Date.now();
    const samples: LocationSample[] = [];
    let bestAccuracy = Infinity;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watchId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const finishWithCluster = () => {
      if (settled || samples.length === 0) return;
      settled = true;
      cleanup();
      resolve(computeWeightedLocation(samples));
    };

    // Timeout safety net: resolve with weighted centroid of collected fresh fixes, else fail clearly
    timer = setTimeout(() => {
      if (settled) return;
      if (samples.length > 0) {
        finishWithCluster();
      } else {
        settled = true;
        cleanup();
        const timeoutErr = new Error(
          'GPS satellite acquisition timed out without a fresh fix. Ensure GPS/Location Services are enabled and retry near a window or doorway.'
        );
        (timeoutErr as any).code = 3;
        reject(timeoutErr);
      }
    }, timeoutMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;

          const now = Date.now();
          const { latitude, longitude, accuracy } = pos.coords;

          // Discard invalid or null-island coordinates
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            !Number.isFinite(accuracy) ||
            accuracy <= 0 ||
            (latitude === 0 && longitude === 0)
          ) {
            return;
          }

          // Reject stale cached positions older than maxStaleAgeMs (default 10s)
          const fixTimestamp = typeof pos.timestamp === 'number' && pos.timestamp > 0 ? pos.timestamp : now;
          const ageMs = now - fixTimestamp;
          if (ageMs > maxStaleAgeMs) {
            onProgress?.({
              accuracy,
              bestAccuracy: Number.isFinite(bestAccuracy) ? bestAccuracy : accuracy,
              sampleCount: samples.length,
              step: 'Discarding stale cached fix...',
            });
            return;
          }

          samples.push({
            latitude,
            longitude,
            accuracy,
            timestamp: fixTimestamp,
          });

          if (accuracy < bestAccuracy) {
            bestAccuracy = accuracy;
          }

          const crispCount = samples.filter((s) => s.accuracy <= 12).length;
          const targetCount = samples.filter((s) => s.accuracy <= targetAccuracyM).length;
          const elapsed = now - startTime;

          onProgress?.({
            accuracy,
            bestAccuracy,
            sampleCount: samples.length,
            step:
              crispCount >= 3 || (elapsed >= minSampleMs && targetCount >= 3)
                ? 'High-precision GPS lock acquired'
                : bestAccuracy <= targetAccuracyM
                ? 'Averaging satellite fixes...'
                : 'Refining GPS satellite signal...',
          });

          // Early convergence:
          // - Immediately once >= 3 crisp satellite samples (<= 12m) are collected
          // - Or after minimum warmup (>= 2000ms) once >= 3 samples meet targetAccuracyM
          if (crispCount >= 3 || (elapsed >= minSampleMs && targetCount >= 3)) {
            finishWithCluster();
          }
        },
        (err) => {
          if (settled) return;
          // Permission denied must fail immediately
          if (err?.code === 1) {
            settled = true;
            cleanup();
            reject(err);
            return;
          }
          // If we already captured fresh samples before a transient GPS error, resolve with them
          if (samples.length > 0) {
            finishWithCluster();
          } else {
            settled = true;
            cleanup();
            reject(err);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutMs,
        }
      );
    } catch (e) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(e);
      }
    }
  });
}
