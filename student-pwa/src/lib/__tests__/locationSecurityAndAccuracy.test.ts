import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

class MockStorage implements Storage {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] ?? null;
  }
  key(index: number) {
    return Object.keys(this.store)[index] ?? null;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as any).localStorage = new MockStorage();
}
if (typeof globalThis.sessionStorage === 'undefined') {
  (globalThis as any).sessionStorage = new MockStorage();
}

import {
  MAX_ALLOWED_ACCURACY_M,
  MAX_FIX_AGE_MS,
  resolveLocationEnabled,
  validateGpsFix,
  detectTeleportationJump,
  selectConsistentClusterAndAverage,
  formatLowAccuracyMessage,
  haversineDistanceMeters,
  acquirePreciseLocation,
} from '../preciseLocation';
import type { GpsFix } from '../preciseLocation';
import {
  initAttemptState,
  updateAttemptLocation,
  clearAttemptLocation,
  getAttemptState,
  isLocationRequirementSatisfied,
} from '../attemptState';
import { attendanceService, ApiError } from '../attendanceService';

describe('Student PWA High-Accuracy GNSS & Anti-Bypass Security Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. URL Query-Param Bypass Prevention', () => {
    it('resolveLocationEnabled strictly trusts server boolean true', () => {
      expect(resolveLocationEnabled(true)).toBe(true);
      expect(resolveLocationEnabled(false)).toBe(false);
      expect(resolveLocationEnabled(undefined)).toBe(false);
      expect(resolveLocationEnabled(null)).toBe(false);
      expect(resolveLocationEnabled('true')).toBe(false);
    });

    it('JoinTokenPage.tsx never reads ?loc= query parameter to override server location_enabled', () => {
      const joinPageSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/JoinTokenPage.tsx'),
        'utf-8'
      );
      expect(joinPageSrc).not.toContain("searchParams.get('loc')");
      expect(joinPageSrc).not.toContain('locParam');
      expect(joinPageSrc).toContain('resolveLocationEnabled(response.location_enabled)');
    });

    it('LandingPage.tsx strips untrusted query parameters from scanned /join/ QR links', () => {
      const landingSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/LandingPage.tsx'),
        'utf-8'
      );
      expect(landingSrc).toContain('split(/[?#]/)');
    });
  });

  describe('2. Stale Cache, Coarse Accuracy & Anti-Spoof Validation', () => {
    const now = 1_700_000_000_000;

    it('rejects stale OS-cached fixes older than 10 seconds', () => {
      const staleFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now - MAX_FIX_AGE_MS - 1,
      };
      const res = validateGpsFix(staleFix, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('STALE_FIX');
    });

    it('rejects future-forged timestamps (> 10s ahead of device clock)', () => {
      const futureFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now + MAX_FIX_AGE_MS + 5000,
      };
      const res = validateGpsFix(futureFix, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('FUTURE_TIMESTAMP');
    });

    it('rejects mock-GPS zero/negative/NaN accuracy', () => {
      for (const badAcc of [0, -1, -15, Number.NaN, Number.POSITIVE_INFINITY]) {
        const res = validateGpsFix(
          { latitude: 6.5244, longitude: 3.3792, accuracy: badAcc, timestamp: now - 500 },
          now
        );
        expect(res.valid).toBe(false);
        expect(res.reason).toBe('INVALID_ACCURACY');
      }
    });

    it('rejects (0, 0) Null Island and out-of-range/NaN coordinates', () => {
      expect(
        validateGpsFix({ latitude: 0, longitude: 0, accuracy: 8, timestamp: now - 500 }, now).reason
      ).toBe('NULL_ISLAND');
      expect(
        validateGpsFix({ latitude: 0.00001, longitude: -0.00001, accuracy: 8, timestamp: now - 500 }, now).reason
      ).toBe('NULL_ISLAND');
      expect(
        validateGpsFix({ latitude: Number.NaN, longitude: 3.37, accuracy: 8, timestamp: now - 500 }, now).reason
      ).toBe('INVALID_COORDINATES');
      expect(
        validateGpsFix({ latitude: 91, longitude: 3.37, accuracy: 8, timestamp: now - 500 }, now).reason
      ).toBe('INVALID_COORDINATES');
    });

    it('enforces strict <= 65m accuracy gate and rejects coarse Wi-Fi/cell guesses', () => {
      expect(
        validateGpsFix({ latitude: 6.5244, longitude: 3.3792, accuracy: 65, timestamp: now - 1000 }, now).valid
      ).toBe(true);
      expect(
        validateGpsFix({ latitude: 6.5244, longitude: 3.3792, accuracy: 65.1, timestamp: now - 1000 }, now).reason
      ).toBe('COARSE_ACCURACY');
      expect(
        validateGpsFix({ latitude: 6.5244, longitude: 3.3792, accuracy: 250, timestamp: now - 1000 }, now).reason
      ).toBe('COARSE_ACCURACY');
    });

    it('detects impossible teleportation jumps (> 100m in < 2s) without flagging normal jitter', () => {
      const fixA: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 12,
        timestamp: now - 1000,
        receivedAt: now - 1000,
      };
      // ~333m north in 1.0s => spoof/teleport
      const fixTeleport: GpsFix = {
        latitude: 6.5274,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now,
        receivedAt: now,
      };
      const teleportResult = detectTeleportationJump(fixA, fixTeleport);
      expect(teleportResult.isTeleport).toBe(true);
      expect(teleportResult.distanceM).toBeGreaterThan(300);

      // ~11m shift in 1.0s => normal indoor GNSS jitter
      const fixJitter: GpsFix = {
        latitude: 6.5245,
        longitude: 3.3792,
        accuracy: 12,
        timestamp: now,
        receivedAt: now,
      };
      expect(detectTeleportationJump(fixA, fixJitter).isTeleport).toBe(false);
    });

    it('attendanceService.verifyLocation fails closed client-side before fetch for coarse or spoofed fixes', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      // Coarse reading (180m > 65m) must NOT hit network
      await expect(
        attendanceService.verifyLocation({
          attemptToken: 'atok_1',
          latitude: 6.5244,
          longitude: 3.3792,
          accuracyM: 180,
        })
      ).rejects.toMatchObject({ code: 'LOW_ACCURACY' });
      expect(fetchSpy).not.toHaveBeenCalled();

      // Zero accuracy mock GPS must NOT hit network
      await expect(
        attendanceService.verifyLocation({
          attemptToken: 'atok_1',
          latitude: 6.5244,
          longitude: 3.3792,
          accuracyM: 0,
        })
      ).rejects.toBeInstanceOf(ApiError);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Null island (0, 0) must NOT hit network
      await expect(
        attendanceService.verifyLocation({
          attemptToken: 'atok_1',
          latitude: 0,
          longitude: 0,
          accuracyM: 10,
        })
      ).rejects.toMatchObject({ code: 'INVALID_COORDINATES' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('formatLowAccuracyMessage gives clear ±Xm vs ±65m actionable guidance', () => {
      const msg = formatLowAccuracyMessage(214.6, MAX_ALLOWED_ACCURACY_M);
      expect(msg).toContain('±215m');
      expect(msg).toContain('±65m');
      expect(msg.toLowerCase()).toContain('window');
      expect(msg.toLowerCase()).toContain('precise location');
    });
  });

  describe('3. Consistent GNSS Clustering & Inverse-Variance Weighted Averaging', () => {
    const now = 1_700_000_000_000;

    it('weights sharp satellite fixes heavily over noisier fixes (inverse-variance weighting)', () => {
      const samples: GpsFix[] = [
        // Noisy fix (50m accuracy, shifted ~15m north)
        { latitude: 6.52454, longitude: 3.37920, accuracy: 50, timestamp: now - 3000 },
        // Sharp satellite fix 1 (8m accuracy)
        { latitude: 6.52440, longitude: 3.37920, accuracy: 8, timestamp: now - 2000 },
        // Sharp satellite fix 2 (10m accuracy)
        { latitude: 6.52441, longitude: 3.37921, accuracy: 10, timestamp: now - 1000 },
      ];

      const result = selectConsistentClusterAndAverage(samples);
      expect(result).not.toBeNull();
      expect(result!.sampleCount).toBe(3);
      // Should be pulled very close to the 8m/10m fixes rather than the 50m fix
      const distToSharp = haversineDistanceMeters(
        result!.latitude,
        result!.longitude,
        6.524404,
        3.379204
      );
      expect(distToSharp).toBeLessThan(2);
      expect(result!.accuracy).toBeLessThan(20);
      expect(result!.accuracy).toBeGreaterThanOrEqual(8);
    });

    it('discards single-sample drift outlier in favor of consistent GNSS cluster', () => {
      const samples: GpsFix[] = [
        // Single drift spike ~120m away
        { latitude: 6.52550, longitude: 3.37920, accuracy: 30, timestamp: now - 4000 },
        // Consistent cluster of 3 fixes inside lecture hall
        { latitude: 6.52440, longitude: 3.37920, accuracy: 14, timestamp: now - 3000 },
        { latitude: 6.52441, longitude: 3.37921, accuracy: 11, timestamp: now - 2000 },
        { latitude: 6.52439, longitude: 3.37919, accuracy: 12, timestamp: now - 1000 },
      ];

      const result = selectConsistentClusterAndAverage(samples);
      expect(result).not.toBeNull();
      expect(result!.sampleCount).toBe(3);
      const distToHall = haversineDistanceMeters(
        result!.latitude,
        result!.longitude,
        6.52440,
        3.37920
      );
      expect(distToHall).toBeLessThan(3);
      expect(result!.accuracy).toBeLessThan(15);
    });
  });

  describe('4. Step Guards & Attempt State Security', () => {
    it('isLocationRequirementSatisfied strictly requires inside_boundary === true when location_enabled is true', () => {
      initAttemptState('tok', 'aid', 'atok', {
        id: 'sid',
        title: 'CSC 301',
        course_code: 'CSC 301',
        course_title: 'Operating Systems',
        starts_at: '2026-11-19T08:00:00Z',
        expires_at: '2026-11-19T10:00:00Z',
        grace_minutes: 15,
        location_enabled: true,
      });

      // Missing location -> blocked
      expect(isLocationRequirementSatisfied(getAttemptState())).toBe(false);

      // Location saved with inside_boundary: false -> blocked
      updateAttemptLocation({
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy_m: 12,
        verified_at: new Date().toISOString(),
        inside_boundary: false,
      });
      expect(isLocationRequirementSatisfied(getAttemptState())).toBe(false);

      // Location saved with inside_boundary: undefined -> blocked
      updateAttemptLocation({
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy_m: 12,
        verified_at: new Date().toISOString(),
      });
      expect(isLocationRequirementSatisfied(getAttemptState())).toBe(false);

      // Location saved with inside_boundary: true -> allowed
      updateAttemptLocation({
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy_m: 12,
        verified_at: new Date().toISOString(),
        inside_boundary: true,
      });
      expect(isLocationRequirementSatisfied(getAttemptState())).toBe(true);

      // clearAttemptLocation invalidates verified location cleanly
      clearAttemptLocation();
      expect(getAttemptState()?.location).toBeUndefined();
      expect(isLocationRequirementSatisfied(getAttemptState())).toBe(false);
    });

    it('AttendSelfiePage, AttendVideoPage, and AttendLocationPage enforce strict inside_boundary === true guards', () => {
      const selfieSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/AttendSelfiePage.tsx'),
        'utf-8'
      );
      const videoSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/AttendVideoPage.tsx'),
        'utf-8'
      );
      const locSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/AttendLocationPage.tsx'),
        'utf-8'
      );

      expect(selfieSrc).toContain('isLocationRequirementSatisfied');
      expect(videoSrc).toContain('isLocationRequirementSatisfied');
      expect(videoSrc).toContain('clearAttemptLocation');
      expect(locSrc).toContain('result.success === true && result.inside_boundary === true');
      expect(locSrc).toContain('validateGpsFix');
      expect(locSrc).toContain('detectTeleportationJump');
      expect(locSrc).toContain('selectConsistentClusterAndAverage');
    });
  });

  describe('5. Live watchPosition GNSS Acquisition Simulation', () => {
    it('discards stale, coarse, and null-island readings and resolves on consistent fresh GNSS cluster', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let watchCallback: PositionCallback | null = null;
      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        watchCallback = cb;
        return 42;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquirePreciseLocation({ timeoutMs: 12_000 });

      // 1. Stale cached fix (30s old) -> ignored
      watchCallback!({
        coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 8 } as GeolocationCoordinates,
        timestamp: baseNow - 30_000,
      } as GeolocationPosition);

      // 2. Coarse cell tower fix (240m) -> ignored
      watchCallback!({
        coords: { latitude: 6.5299, longitude: 3.3850, accuracy: 240 } as GeolocationCoordinates,
        timestamp: baseNow,
      } as GeolocationPosition);

      // 3. Mock (0, 0) Null Island -> ignored
      watchCallback!({
        coords: { latitude: 0, longitude: 0, accuracy: 5 } as GeolocationCoordinates,
        timestamp: baseNow,
      } as GeolocationPosition);

      // 4. Fresh satellite fix #1 (14m)
      vi.setSystemTime(baseNow + 1000);
      watchCallback!({
        coords: { latitude: 6.52440, longitude: 3.37920, accuracy: 14 } as GeolocationCoordinates,
        timestamp: baseNow + 1000,
      } as GeolocationPosition);

      // 5. Fresh satellite fix #2 (10m) consistent with #1 -> resolves fast lock!
      vi.setSystemTime(baseNow + 2000);
      watchCallback!({
        coords: { latitude: 6.52441, longitude: 3.37921, accuracy: 10 } as GeolocationCoordinates,
        timestamp: baseNow + 2000,
      } as GeolocationPosition);

      const loc = await promise;
      expect(loc.sampleCount).toBe(2);
      expect(loc.accuracy).toBeLessThanOrEqual(15);
      expect(clearWatch).toHaveBeenCalledWith(42);
    });

    it('rejects immediately on teleportation jump between consecutive high-accuracy fixes', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let watchCallback: PositionCallback | null = null;
      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        watchCallback = cb;
        return 7;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquirePreciseLocation({ timeoutMs: 12_000 });

      // Fix 1 at dorm
      watchCallback!({
        coords: { latitude: 6.5200, longitude: 3.3792, accuracy: 12 } as GeolocationCoordinates,
        timestamp: baseNow,
      } as GeolocationPosition);

      // Fix 2 spoofed ~480m north 0.8s later
      vi.setSystemTime(baseNow + 800);
      watchCallback!({
        coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 10 } as GeolocationCoordinates,
        timestamp: baseNow + 800,
      } as GeolocationPosition);

      await expect(promise).rejects.toMatchObject({ code: 'GPS_TELEPORT_DETECTED' });
      expect(clearWatch).toHaveBeenCalledWith(7);
    });

    it('rejects with LOW_ACCURACY after timeout if phone only achieves > 65m accuracy', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let watchCallback: PositionCallback | null = null;
      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        watchCallback = cb;
        return 9;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquirePreciseLocation({ timeoutMs: 12_000 });

      watchCallback!({
        coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 185 } as GeolocationCoordinates,
        timestamp: baseNow,
      } as GeolocationPosition);

      vi.advanceTimersByTime(12_000);

      await expect(promise).rejects.toMatchObject({
        code: 'LOW_ACCURACY',
        accuracyM: 185,
      });
      expect(clearWatch).toHaveBeenCalledWith(9);
    });
  });
});
