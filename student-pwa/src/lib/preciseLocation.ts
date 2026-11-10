/**
 * High-Precision GPS Satellite Acquisition
 * 
 * Uses navigator.geolocation.watchPosition with { enableHighAccuracy: true, maximumAge: 0 }
 * to actively wake up the device's hardware GPS satellite receiver, streaming fixes
 * until satellite-grade precision is achieved (target <= 15m) or the sampling window completes.
 * 
 * Eliminates cached positions, stale location cookies, and coarse cellular triangulation.
 */

export interface PreciseLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface AcquireLocationOptions {
  timeoutMs?: number;
  targetAccuracyM?: number;
  onProgress?: (progress: { accuracy: number; step: string }) => void;
}

export function acquirePreciseLocation(options: AcquireLocationOptions = {}): Promise<PreciseLocation> {
  const {
    timeoutMs = 12000,
    targetAccuracyM = 15,
    onProgress,
  } = options;

  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      const err = new Error('Geolocation is not supported by your mobile browser.');
      (err as any).code = 2;
      return reject(err);
    }

    let bestReading: GeolocationPosition | null = null;
    let timer: any = null;
    let watchId: number | null = null;

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

    // Timeout safety net: accept best fix if available, else fail with clear reason
    timer = setTimeout(() => {
      cleanup();
      if (bestReading && bestReading.coords.accuracy <= targetAccuracyM) {
        resolve({
          latitude: bestReading.coords.latitude,
          longitude: bestReading.coords.longitude,
          accuracy: bestReading.coords.accuracy,
        });
      } else if (bestReading) {
        const lowAccErr = new Error('Low accuracy after timeout');
        (lowAccErr as any).code = 2; // reuse code 2 for low accuracy
        reject(lowAccErr);
      } else {
        const timeoutErr = new Error('GPS satellite acquisition timed out. Ensure location services are turned on and retry.');
        (timeoutErr as any).code = 3;
        reject(timeoutErr);
      }
    }, timeoutMs);

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = pos.coords.accuracy;
          if (!bestReading || acc < bestReading.coords.accuracy) {
            bestReading = pos;
          }

          onProgress?.({
            accuracy: acc,
            step: acc <= targetAccuracyM ? 'GPS Lock Acquired' : 'Waking up satellite receiver...',
          });

          // High accuracy satellite fix achieved: resolve immediately
          if (acc <= targetAccuracyM) {
            cleanup();
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: acc,
            });
          }
        },
        (err) => {
          // If we haven't acquired any reading at all, propagate error
          if (!bestReading) {
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
      cleanup();
      reject(e);
    }
  });
}
