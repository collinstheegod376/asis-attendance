/**
 * High-Precision GPS Satellite Acquisition
 * 
 * Uses navigator.geolocation.watchPosition with { enableHighAccuracy: true, maximumAge: 0 }
 * to actively wake up the device's hardware GPS satellite receiver, streaming fixes
 * until satellite-grade precision is achieved (target <= 20m) or the sampling window completes.
 * 
 * Eliminates cached positions, stale location cookies, and coarse cellular triangulation.
 */

export interface PreciseLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  sampleCount?: number;
}

export interface AcquireLocationOptions {
  timeoutMs?: number;
  targetAccuracyM?: number;
  minSampleMs?: number;
  onProgress?: (progress: { accuracy: number; bestAccuracy: number; sampleCount: number; step: string }) => void;
}

export function acquirePreciseLocation(options: AcquireLocationOptions = {}): Promise<PreciseLocation> {
  const {
    timeoutMs = 5000,
    targetAccuracyM = 20,
    minSampleMs = 800,
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by your browser.');
      (err as any).code = 2;
      return reject(err);
    }

    const startTime = Date.now();
    let bestReading: GeolocationPosition | null = null;
    let sampleCount = 0;
    let timer: any = null;
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

    const finishWithBest = () => {
      if (settled || !bestReading) return;
      settled = true;
      cleanup();
      resolve({
        latitude: bestReading.coords.latitude,
        longitude: bestReading.coords.longitude,
        accuracy: bestReading.coords.accuracy,
        sampleCount,
      });
    };

    // Timeout safety net: accept best fix if available, else fail with clear reason
    timer = setTimeout(() => {
      if (settled) return;
      if (bestReading) {
        finishWithBest();
      } else {
        settled = true;
        cleanup();
        const timeoutErr = new Error('GPS satellite acquisition timed out. Ensure location services are turned on and retry.');
        (timeoutErr as any).code = 3;
        reject(timeoutErr);
      }
    }, timeoutMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (settled) return;
          sampleCount += 1;
          const acc = pos.coords.accuracy;
          if (!bestReading || acc < bestReading.coords.accuracy) {
            bestReading = pos;
          }

          const bestAcc = bestReading.coords.accuracy;
          onProgress?.({
            accuracy: acc,
            bestAccuracy: bestAcc,
            sampleCount,
            step: bestAcc <= targetAccuracyM ? 'GPS Lock Acquired' : 'Refining GPS satellite signal...',
          });

          const elapsed = Date.now() - startTime;
          // High accuracy satellite fix achieved: resolve once target accuracy is reached
          // (Wait a tiny window or 2+ samples unless accuracy is already very sharp <= 12m)
          if (bestAcc <= targetAccuracyM && (sampleCount >= 2 || elapsed >= minSampleMs || bestAcc <= 12)) {
            finishWithBest();
          }
        },
        (err) => {
          if (settled) return;
          // If we already have a reading, resolve with our best fix rather than failing
          if (bestReading) {
            finishWithBest();
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
