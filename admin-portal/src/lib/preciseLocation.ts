/**
 * High-Precision GPS Satellite Acquisition (Lecturer Portal)
 *
 * Uses parallel navigator.geolocation.getCurrentPosition + watchPosition with
 * { enableHighAccuracy: true, maximumAge: 0 } to immediately wake the hardware
 * GNSS receiver on iOS Safari and Android Chrome, isolate Tier-1 satellite fixes
 * (<= 65m) from coarse 1km grid/cell-tower callbacks (like ±1414m), and compute
 * an inverse-variance (1/accuracy^2) weighted centroid over the tightest cluster.
 */

export interface PreciseLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  sampleCount: number;
  clusteredSamples?: number;
  isCoarse?: boolean;
  coarseReason?: 'APPROXIMATE_OR_DESKTOP_LOCATION' | 'MODERATE_INDOOR_DRIFT';
}

export interface AcquireLocationOptions {
  timeoutMs?: number;
  targetAccuracyM?: number;
  minSampleMs?: number;
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
  receivedAt: number;
}

const EARTH_RADIUS_M = 6371000;

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
  return EARTH_RADIUS_M * c;
}

/**
 * Computes an inverse-variance (1/accuracy^2) weighted centroid from the tightest
 * spatially consistent cluster of GPS samples:
 *  - Isolates Tier 1 (<= 65m) from Tier 2 (65m-150m) and Tier 3 (> 150m coarse grid)
 *    so a ±1414m cell/IP callback never pollutes or shifts a hardware GPS fix.
 *  - Keeps samples within 1.5x of the best observed accuracy and within 25m of the best point.
 */
function computeWeightedLocation(allSamples: LocationSample[]): PreciseLocation {
  const tier1 = allSamples.filter((s) => s.accuracy <= 65);
  const tier2 = allSamples.filter((s) => s.accuracy > 65 && s.accuracy <= 150);
  const pool = tier1.length > 0 ? tier1 : tier2.length > 0 ? tier2 : allSamples;

  const sorted = [...pool].sort((a, b) => a.accuracy - b.accuracy);
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

  const isCoarse = best.accuracy > 100;
  const coarseReason =
    best.accuracy > 150
      ? 'APPROXIMATE_OR_DESKTOP_LOCATION'
      : best.accuracy > 65
      ? 'MODERATE_INDOOR_DRIFT'
      : undefined;

  return {
    latitude: weightedLatSum / weightSum,
    longitude: weightedLngSum / weightSum,
    accuracy: best.accuracy,
    sampleCount: allSamples.length,
    clusteredSamples: activeCluster.length,
    isCoarse,
    coarseReason,
  };
}

export function acquirePreciseLocation(options: AcquireLocationOptions = {}): Promise<PreciseLocation> {
  const {
    timeoutMs = 8000,
    targetAccuracyM = 20,
    minSampleMs = 1500,
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

    const handleIncomingPosition = (pos: GeolocationPosition) => {
      if (settled) return;

      const now = Date.now();
      const { latitude, longitude, accuracy } = pos.coords;

      // Discard invalid or null-island coordinates
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(accuracy) ||
        accuracy <= 0 ||
        (Math.abs(latitude) < 0.0001 && Math.abs(longitude) < 0.0001)
      ) {
        return;
      }

      // NOTE: Do NOT discard hardware GNSS fixes (accuracy <= 65m) based on pos.timestamp!
      // On stationary iOS Safari / Android devices, the OS GNSS chip often emits a valid
      // stationary satellite fix carrying the timestamp of when the device last moved (15-60s ago).
      // Discarding it leaves only the fresh ±1414m cell/network grid reading.
      samples.push({
        latitude,
        longitude,
        accuracy,
        receivedAt: now,
      });

      if (accuracy < bestAccuracy) {
        bestAccuracy = accuracy;
      }

      const tier1Samples = samples.filter((s) => s.accuracy <= 65);
      const crispCount = tier1Samples.filter((s) => s.accuracy <= 15).length;
      const targetCount = tier1Samples.filter((s) => s.accuracy <= targetAccuracyM).length;
      const elapsed = now - startTime;

      onProgress?.({
        accuracy,
        bestAccuracy,
        sampleCount: samples.length,
        step:
          crispCount >= 2 || (elapsed >= minSampleMs && targetCount >= 2)
            ? 'High-precision GPS lock acquired'
            : bestAccuracy <= 65
            ? `Averaging satellite fixes (±${Math.round(bestAccuracy)}m)...`
            : 'Waiting for hardware GPS satellite lock...',
      });

      // Early convergence ONLY on genuine Tier-1 satellite fixes (never on ±1414m coarse fixes):
      // - Immediately once >= 2 crisp satellite samples (<= 15m) are collected
      // - After minimum warmup (>= 1500ms) once >= 2 samples meet targetAccuracyM (<= 20m)
      // - After 3200ms if we have at least 1 good hardware fix <= 35m
      if (
        crispCount >= 2 ||
        (elapsed >= minSampleMs && targetCount >= 2) ||
        (elapsed >= 3200 && bestAccuracy <= 35)
      ) {
        finishWithCluster();
      }
    };

    // Timeout safety net: resolve with weighted centroid of best tier collected
    timer = setTimeout(() => {
      if (settled) return;
      if (samples.length > 0) {
        finishWithCluster();
      } else {
        settled = true;
        cleanup();
        const timeoutErr = new Error(
          'GPS satellite acquisition timed out. Please retry near a window or doorway, or enter coordinates manually.'
        );
        (timeoutErr as any).code = 3;
        reject(timeoutErr);
      }
    }, timeoutMs);

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: timeoutMs,
    };

    // Stage 1: Fire an immediate one-shot getCurrentPosition in parallel to force A-GPS wake-up on iOS/Android
    try {
      navigator.geolocation.getCurrentPosition(
        handleIncomingPosition,
        () => {
          // Handled by watchPosition / timeout
        },
        geoOptions
      );
    } catch {}

    // Stage 2: Continuous watchPosition stream for multi-sample satellite convergence
    try {
      watchId = navigator.geolocation.watchPosition(
        handleIncomingPosition,
        (err) => {
          if (settled) return;
          if (err?.code === 1) {
            settled = true;
            cleanup();
            reject(err);
            return;
          }
          if (samples.length > 0 && bestAccuracy <= 65) {
            finishWithCluster();
          }
        },
        geoOptions
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
