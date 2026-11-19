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
  MAX_ACQUISITION_WINDOW_MS,
  MAX_FIX_AGE_MS,
  MAX_FUTURE_SKEW_MS,
  normalizeGpsTimestamp,
  resolveLocationEnabled,
  validateGpsFix,
  detectTeleportationJump,
  selectConsistentClusterAndAverage,
  formatLowAccuracyMessage,
  haversineDistanceMeters,
  acquirePreciseLocation,
  acquireBestFix,
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
import { getDeviceHash } from '../deviceFingerprint';
import { createHeartbeatManager, HEARTBEAT_INTERVAL_MS } from '../heartbeatManager';

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

    it('LandingPage.tsx preserves qt/qs params while stripping untrusted query parameters from scanned /join/ QR links', () => {
      const landingSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/LandingPage.tsx'),
        'utf-8'
      );
      expect(landingSrc).toContain("incoming.get('qt')");
      expect(landingSrc).toContain("incoming.get('qs')");
      expect(landingSrc).not.toContain("incoming.get('loc')");
    });
  });

  describe('2. Stale Cache, Coarse Accuracy & Anti-Spoof Validation', () => {
    const now = 1_700_000_000_000;

    it('accepts stationary hardware GNSS fixes up to 60 seconds old (e.g. 25s old) and rejects stale fixes older than 60 seconds', () => {
      // Stationary student phone inside lecture hall: 25s old hardware satellite fix must be accepted
      const stationaryFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 12,
        timestamp: now - 25_000,
      };
      expect(validateGpsFix(stationaryFix, now).valid).toBe(true);

      // Genuine stale cached OS fix (> 60s old, e.g. 75s) must be rejected as STALE_FIX
      const staleFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now - 75_000,
      };
      const res = validateGpsFix(staleFix, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('STALE_FIX');
    });

    it('allows minor monotonic clock skew up to 15s and rejects future-forged timestamps (> 15s ahead)', () => {
      const slightSkewFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now + 5_000,
      };
      expect(validateGpsFix(slightSkewFix, now).valid).toBe(true);

      const futureFix: GpsFix = {
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy: 10,
        timestamp: now + MAX_FUTURE_SKEW_MS + 5_000,
      };
      const res = validateGpsFix(futureFix, now);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('FUTURE_TIMESTAMP');
    });

    it('normalizes missing or monotonic boot-clock timestamps (< 1e12) while preserving Unix epoch timestamps', () => {
      expect(normalizeGpsTimestamp(undefined, now)).toBe(now);
      expect(normalizeGpsTimestamp(0, now)).toBe(now);
      expect(normalizeGpsTimestamp(45_230, now)).toBe(now); // monotonic performance.now()
      expect(normalizeGpsTimestamp(now - 25_000, now)).toBe(now - 25_000); // true epoch preserved
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

    it('enforces <= 120m accuracy gate and rejects coarse Wi-Fi/cell guesses', () => {
      expect(MAX_ALLOWED_ACCURACY_M).toBe(120);
      expect(MAX_ACQUISITION_WINDOW_MS).toBe(15_000);
      expect(
        validateGpsFix({ latitude: 6.5244, longitude: 3.3792, accuracy: 120, timestamp: now - 1000 }, now).valid
      ).toBe(true);
      expect(
        validateGpsFix({ latitude: 6.5244, longitude: 3.3792, accuracy: 120.1, timestamp: now - 1000 }, now).reason
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

    it('formatLowAccuracyMessage gives clear ±Xm vs ±120m actionable guidance including OS Precise Location steps for >= 500m', () => {
      const msg = formatLowAccuracyMessage(214.6, MAX_ALLOWED_ACCURACY_M);
      expect(msg).toContain('±215m');
      expect(msg).toContain('±120m');
      expect(msg.toLowerCase()).toContain('window');
      expect(msg.toLowerCase()).toContain('precise location');

      const approxMsg = formatLowAccuracyMessage(1414.2, MAX_ALLOWED_ACCURACY_M);
      expect(approxMsg).toContain('±1414m');
      expect(approxMsg).toContain('±120m');
      expect(approxMsg).toContain('Precise Location');
      expect(approxMsg).toContain('iOS:');
      expect(approxMsg).toContain('Android:');
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
    it('discards stale (> 60s), coarse, and null-island readings, fires parallel getCurrentPosition, and resolves on consistent fresh GNSS cluster', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let watchCallback: PositionCallback | null = null;
      const clearWatch = vi.fn();
      const getCurrentPosition = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        watchCallback = cb;
        return 42;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, getCurrentPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquirePreciseLocation({ timeoutMs: 12_000 });
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(watchPosition).toHaveBeenCalledTimes(1);

      // 1. Stale cached fix (75s old > 60s limit) -> ignored
      watchCallback!({
        coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 8 } as GeolocationCoordinates,
        timestamp: baseNow - 75_000,
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

      // 4. Stationary hardware satellite fix #1 (14m, timestamp from 25s ago) -> accepted!
      vi.setSystemTime(baseNow + 1000);
      watchCallback!({
        coords: { latitude: 6.52440, longitude: 3.37920, accuracy: 14 } as GeolocationCoordinates,
        timestamp: baseNow - 24_000,
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

    it('rejects with LOW_ACCURACY after timeout if phone only achieves > 120m accuracy', async () => {
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

      const promise = acquirePreciseLocation({ timeoutMs: 15_000 });

      watchCallback!({
        coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 185 } as GeolocationCoordinates,
        timestamp: baseNow,
      } as GeolocationPosition);

      vi.advanceTimersByTime(15_000);

      await expect(promise).rejects.toMatchObject({
        code: 'LOW_ACCURACY',
        accuracyM: 185,
      });
      expect(clearWatch).toHaveBeenCalledWith(9);
    });
  });

  describe('6. Issue 5 acquireBestFix() Two-Fix Selection', () => {
    it('keeps the better (70m) fix when retry returns 110m', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let callCount = 0;
      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        callCount += 1;
        const currentCall = callCount;
        setTimeout(() => {
          cb({
            coords: {
              latitude: 6.5244,
              longitude: 3.3792,
              accuracy: currentCall === 1 ? 70 : 110,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 100);
        return currentCall;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquireBestFix();
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(10_000);

      const fix = await promise;
      expect(watchPosition).toHaveBeenCalledTimes(2);
      expect(fix.accuracy).toBe(70);
    });

    it('takes the sharper (45m) retry fix when initial fix is 70m', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      let callCount = 0;
      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        callCount += 1;
        const currentCall = callCount;
        setTimeout(() => {
          cb({
            coords: {
              latitude: 6.5244,
              longitude: 3.3792,
              accuracy: currentCall === 1 ? 70 : 45,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 100);
        return currentCall;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquireBestFix();
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.advanceTimersByTimeAsync(10_000);

      const fix = await promise;
      expect(watchPosition).toHaveBeenCalledTimes(2);
      expect(fix.accuracy).toBe(45);
    });

    it('returns immediately with no retry when initial fix is <= 60m (e.g. 30m)', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      const clearWatch = vi.fn();
      const watchPosition = vi.fn((cb: PositionCallback) => {
        setTimeout(() => {
          cb({
            coords: { latitude: 6.5244, longitude: 3.3792, accuracy: 30 } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition);
        }, 100);
        return 1;
      });

      Object.defineProperty(globalThis, 'navigator', {
        value: { geolocation: { watchPosition, clearWatch } },
        configurable: true,
      });

      const promise = acquireBestFix();
      await vi.advanceTimersByTimeAsync(15_000);

      const fix = await promise;
      expect(watchPosition).toHaveBeenCalledTimes(1);
      expect(fix.accuracy).toBe(30);
    });
  });

  describe('7. HeartbeatManager (Issue 6 & User Decision A2)', () => {
    it('does not start and fires 0 heartbeats if session is already expired', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      initAttemptState('tok', 'aid', 'atok', {
        id: 'sid',
        title: 'CSC 301',
        course_code: 'CSC 301',
        course_title: 'OS',
        starts_at: new Date(baseNow - 600_000).toISOString(),
        expires_at: new Date(baseNow - 1_000).toISOString(),
        grace_minutes: 15,
        location_enabled: true,
      });

      const mgr = createHeartbeatManager();
      expect(mgr.start()).toBe(false);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stops automatically when expires_at is reached and when SESSION_ENDED is returned', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ inside_fence: true }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 410,
          json: async () => ({ error: 'SESSION_ENDED' }),
        });
      global.fetch = fetchSpy;

      initAttemptState('tok', 'aid', 'atok', {
        id: 'sid',
        title: 'CSC 301',
        course_code: 'CSC 301',
        course_title: 'OS',
        starts_at: new Date(baseNow).toISOString(),
        expires_at: new Date(baseNow + HEARTBEAT_INTERVAL_MS * 3).toISOString(),
        grace_minutes: 15,
        location_enabled: true,
      });

      const mgr = createHeartbeatManager();
      expect(mgr.start()).toBe(true);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mgr.getStatus().active).toBe(true);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mgr.getStatus().active).toBe(false);
      expect(mgr.getStatus().sessionEnded).toBe(true);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('queues failed_events on network error (max 2 retries) and flushes them on next successful heartbeat', async () => {
      vi.useFakeTimers();
      const baseNow = 1_700_000_000_000;
      vi.setSystemTime(baseNow);

      const fetchSpy = vi
        .fn()
        // First tick: 1 initial + 2 retries all fail
        .mockRejectedValueOnce(new Error('Network down'))
        .mockRejectedValueOnce(new Error('Network down'))
        .mockRejectedValueOnce(new Error('Network down'))
        // Second tick: succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ inside_fence: false }),
        });
      global.fetch = fetchSpy;

      initAttemptState('tok', 'aid', 'atok', {
        id: 'sid',
        title: 'CSC 301',
        course_code: 'CSC 301',
        course_title: 'OS',
        starts_at: new Date(baseNow).toISOString(),
        expires_at: new Date(baseNow + HEARTBEAT_INTERVAL_MS * 4).toISOString(),
        grace_minutes: 15,
        location_enabled: true,
      });

      const mgr = createHeartbeatManager();
      mgr.start();

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + 2 retries
      expect(mgr.getStatus().failedEventsCount).toBe(1);

      await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      const lastCallBody = JSON.parse(fetchSpy.mock.calls[3][1].body as string);
      expect(lastCallBody.failed_events).toHaveLength(1);
      expect(lastCallBody.failed_events[0].type).toBe('heartbeat_failed');
      expect(mgr.getStatus().failedEventsCount).toBe(0);
      expect(mgr.getStatus().insideFence).toBe(false);
    });
  });

  describe('8. Device Hash Stability & LIVE_QR_REQUIRED Handling', () => {
    it('getDeviceHash() returns a stable 64-char SHA-256 hex across repeated calls', async () => {
      const h1 = await getDeviceHash();
      const h2 = await getDeviceHash();
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
      expect(h2).toBe(h1);
      expect(localStorage.getItem('device_fp_uuid_v1')).toBeTruthy();
    });

    it('JoinTokenPage.tsx and AttendVideoPage.tsx handle LIVE_QR_REQUIRED cleanly', () => {
      const joinSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/JoinTokenPage.tsx'),
        'utf-8'
      );
      const videoSrc = fs.readFileSync(
        path.resolve(__dirname, '../../pages/AttendVideoPage.tsx'),
        'utf-8'
      );
      const expectedMsg =
        'Please scan the live QR code on the projector screen. Links shared via WhatsApp or email will not work in live mode.';

      expect(joinSrc).toContain('LIVE_QR_REQUIRED');
      expect(joinSrc).toContain(expectedMsg);
      expect(videoSrc).toContain('LIVE_QR_REQUIRED');
      expect(videoSrc).toContain(expectedMsg);
    });
  });
});
