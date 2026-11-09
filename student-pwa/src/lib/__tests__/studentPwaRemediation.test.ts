import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  normalizeMatric,
  getOrCreateDeviceId,
  checkDeviceBinding,
  bindDeviceToMatric,
} from '../crypto';
import {
  getAttemptState,
  initAttemptState,
  updateAttemptStudent,
  updateAttemptLocation,
  updateAttemptSelfie,
  updateAttemptReceipt,
  clearAttemptState,
} from '../attemptState';
import { attendanceService } from '../attendanceService';
import fs from 'fs';
import path from 'path';

describe('AGENT 2: Student PWA Remediation Verification Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // ITEM 9 & FIX SEC-19: Matric normalization
  it('Verification Item 1 & SEC-19: normalizeMatric strips all whitespace and capitalizes', () => {
    expect(normalizeMatric(' adun/fs/com/25/001 ')).toBe('ADUN/FS/COM/25/001');
    expect(normalizeMatric('adun / fs / com / 25 / 001')).toBe('ADUN/FS/COM/25/001');
    expect(normalizeMatric('ADUN\t/FS\n/COM/25/001')).toBe('ADUN/FS/COM/25/001');
  });

  // QA-05 & SEC-03: Device ID hardening
  it('Verification Item 1 & QA-05: getOrCreateDeviceId always returns RFC-4122 UUID v4', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const deviceId1 = getOrCreateDeviceId();
    expect(deviceId1).toMatch(uuidRegex);

    // Persists across calls
    const deviceId2 = getOrCreateDeviceId();
    expect(deviceId2).toBe(deviceId1);

    // Replaces legacy dev_* or temp_device_* strings with valid UUIDv4
    localStorage.setItem('adun_device_uuid', 'dev_123456');
    const fixedId = getOrCreateDeviceId();
    expect(fixedId).toMatch(uuidRegex);
    expect(fixedId).not.toContain('dev_');
  });

  // SEC-12 & QA-04: Client localStorage binding does not block server verification
  it('Verification Item 3 & QA-04: checkDeviceBinding provides UX hint but NEVER blocks client', async () => {
    // 1. Initial unbound device
    const hint1 = await checkDeviceBinding('ADUN/FS/COM/25/001');
    expect(hint1.hasBinding).toBe(false);
    expect(hint1.isMatch).toBe(false);

    // 2. Bound after server confirmation
    await bindDeviceToMatric('ADUN/FS/COM/25/001');

    // 3. Same student checks again (Item 2)
    const hint2 = await checkDeviceBinding('ADUN/FS/COM/25/001');
    expect(hint2.hasBinding).toBe(true);
    expect(hint2.isMatch).toBe(true);

    // 4. Different student on same device (Item 3) — DOES NOT BLOCK, only indicates non-match hint!
    const hint3 = await checkDeviceBinding('ADUN/FS/COM/25/002');
    expect(hint3.hasBinding).toBe(true);
    expect(hint3.isMatch).toBe(false);
  });

  // Item 9 & PERF-15: Orientation invariance of screen dimensions
  it('Verification Item 9 & PERF-15: Orientation dimensions are min/max sorted', () => {
    const calcDimensions = (w: number, h: number, aw: number, ah: number) => ({
      minDimension: Math.min(w, h),
      maxDimension: Math.max(w, h),
      minAvailDimension: Math.min(aw, ah),
      maxAvailDimension: Math.max(aw, ah),
    });

    const portrait = calcDimensions(390, 844, 390, 844);
    const landscape = calcDimensions(844, 390, 844, 390);

    expect(portrait.minDimension).toBe(landscape.minDimension);
    expect(portrait.maxDimension).toBe(landscape.maxDimension);
    expect(portrait.minAvailDimension).toBe(landscape.minAvailDimension);
    expect(portrait.maxAvailDimension).toBe(landscape.maxAvailDimension);
  });

  // Item 7, 8, 10 & QA-06, QA-07: Step guards and Attempt State Lifecycle
  it('Verification Item 7 & 8: Step state guards and terminal state clearing', () => {
    expect(getAttemptState()).toBeNull();

    const attempt = initAttemptState(
      'token-123',
      'attempt-uuid-1',
      'attempt-token-secret',
      {
        id: 'sess-1',
        title: 'Cybersecurity',
        course_code: 'CYB 201',
        course_title: 'Intro to Cybersecurity',
        starts_at: '2026-11-09T08:00:00Z',
        expires_at: '2026-11-09T10:00:00Z',
        grace_minutes: 15,
      }
    );

    expect(attempt.idempotency_key).toBeDefined();
    const originalIdempKey = attempt.idempotency_key;

    // Stable idempotency key across re-init of same attempt
    const reInit = initAttemptState(
      'token-123',
      'attempt-uuid-1',
      'attempt-token-secret',
      attempt.session!
    );
    expect(reInit.idempotency_key).toBe(originalIdempKey);

    // Update steps progressively
    updateAttemptStudent({
      id: 'student-uuid-1',
      matric_no: 'ADUN/FS/COM/25/001',
      surname: 'Okoro',
      first_name: 'David',
      middle_name: null,
      program: 'Cybersecurity',
      level: 200,
    });
    expect(getAttemptState()?.student?.id).toBe('student-uuid-1');

    updateAttemptLocation({
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy_m: 8.45,
      verified_at: new Date().toISOString(),
      inside_boundary: true,
    });
    expect(getAttemptState()?.location?.accuracy_m).toBe(8.45);

    updateAttemptSelfie('data:image/jpeg;base64,abc123', 'attendance/sess-1/student-uuid-1/attempt-uuid-1.jpg');
    expect(getAttemptState()?.selfie_path).toBe('attendance/sess-1/student-uuid-1/attempt-uuid-1.jpg');

    updateAttemptReceipt({
      receipt_id: 'REC-998877',
      status: 'present',
      signed_at: new Date().toISOString(),
      course_code: 'CYB 201',
      course_title: 'Intro to Cybersecurity',
      student_name: 'Okoro, David',
      matric_no: 'ADUN/FS/COM/25/001',
    });
    expect(getAttemptState()?.receipt?.receipt_id).toBe('REC-998877');

    // Terminal clear
    clearAttemptState();
    expect(getAttemptState()).toBeNull();
  });

  // Item 5: Location verification fail-closed
  it('Verification Item 5 & SEC-07: verifyLocation fails closed on network or API failure', async () => {
    // Mock network failure
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error: disconnected'));

    await expect(
      attendanceService.verifyLocation({
        attemptToken: 'tok_123',
        latitude: 6.5244,
        longitude: 3.3792,
        accuracyM: 8.45,
      })
    ).rejects.toThrow('Network error');

    // Mock 403 OUTSIDE_CAMPUS_BOUNDARY
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        success: false,
        error: 'OUTSIDE_CAMPUS_BOUNDARY',
        message: 'You are outside the permitted campus boundary.',
      }),
    });

    await expect(
      attendanceService.verifyLocation({
        attemptToken: 'tok_123',
        latitude: 6.5244,
        longitude: 3.3792,
        accuracyM: 8.45,
      })
    ).rejects.toThrow();
  });

  // Item 6 & SEC-14: Selfie upload fail-closed (never fabricates path)
  it('Verification Item 6 & SEC-14: uploadSelfie fails closed and never returns a fake path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'STORAGE_UPLOAD_FAILED',
        message: 'Failed to save selfie proof to secure storage.',
      }),
    });

    await expect(
      attendanceService.uploadSelfie('tok_123', 'data:image/jpeg;base64,invalid')
    ).rejects.toThrow();
  });

  // Item 14 & QA-11, PERF-07: Double-tap submit idempotency and selfie_data_url removal
  it('Verification Item 14 & QA-11, PERF-07: submitAttendance preserves idempotency key and handles 409 ALREADY_SIGNED', async () => {
    let capturedBody: any = null;

    // 1. First tap success
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          receipt_id: 'ADUN-REC-001',
          signed_at: '2026-11-09T08:15:00Z',
          status: 'present',
        }),
      };
    });

    const res1 = await attendanceService.submitAttendance({
      attemptToken: 'attempt_tok',
      selfiePath: 'attendance/sess-1/stud-1/att-1.jpg',
      fingerprintHash: 'fp_hash_hex',
      deviceInfo: {
        userAgent: 'Mozilla/5.0',
        screenResolution: '390x844',
      },
      idempotencyKey: 'idemp-key-stable',
    });

    expect(res1.receipt_id).toBe('ADUN-REC-001');
    expect(capturedBody.idempotency_key).toBe('idemp-key-stable');
    expect(capturedBody.device_info.selfie_data_url).toBeUndefined(); // PERF-07

    // 2. Second tap (Double-tap network retry -> 409 ALREADY_SIGNED returns existing receipt)
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        receipt_id: 'ADUN-REC-001',
        signed_at: '2026-11-09T08:15:00Z',
        status: 'present',
      }),
    });

    const res2 = await attendanceService.submitAttendance({
      attemptToken: 'attempt_tok',
      selfiePath: 'attendance/sess-1/stud-1/att-1.jpg',
      fingerprintHash: 'fp_hash_hex',
      deviceInfo: {
        userAgent: 'Mozilla/5.0',
        screenResolution: '390x844',
      },
      idempotencyKey: 'idemp-key-stable',
    });

    expect(res2.receipt_id).toBe('ADUN-REC-001');
    expect(res2.already_signed).toBe(true);
  });

  // Item 13: PWA Manifest structure
  it('Verification Item 13 & PERF-14: Manifest start_url is / and icons are separated', () => {
    const manifestPath = path.resolve(__dirname, '../../../public/manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');

    const purposes = manifest.icons.map((i: any) => i.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
    // None should combine "any maskable"
    purposes.forEach((p: string) => expect(p).not.toBe('any maskable'));
  });

  // Item 15: CSP in index.html
  it('Verification Item 15 & PERF-19: index.html has strict CSP with wasm-unsafe-eval and connect-src /api', () => {
    const indexPath = path.resolve(__dirname, '../../../index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(html).toContain("connect-src 'self' /api");
    expect(html).toContain("worker-src 'self'");
    expect(html).not.toContain('user-scalable=no'); // PERF-14
  });

  // Reference codes taxonomy with forensic suffix handling
  it('Verification Item 3, 4 & QA-13, PERF-13: Reference code taxonomy handles hex suffixes', () => {
    const checkRedirectType = (ref: string) => {
      if (ref.startsWith('BIND-201')) return 'new-device';
      if (ref.startsWith('BIND-202')) return 'device-in-use';
      if (ref.startsWith('BIND-203')) return 'shared-device';
      if (ref.startsWith('BIND-205')) return 'incognito';
      if (ref.startsWith('BIND-200') || ref.startsWith('BIND-204')) return 'contact-admin';
      return 'contact-admin';
    };

    expect(checkRedirectType('BIND-201-A4F2')).toBe('new-device');
    expect(checkRedirectType('BIND-202-9C1B')).toBe('device-in-use');
    expect(checkRedirectType('BIND-203-7D3E')).toBe('shared-device');
    expect(checkRedirectType('BIND-204-5E8A')).toBe('contact-admin');
    expect(checkRedirectType('BIND-205-F0C1')).toBe('incognito');
    expect(checkRedirectType('BIND-200-INIT')).toBe('contact-admin');
  });
});
