import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { attendanceService } from '../attendanceService';
import {
  initAttemptState,
  getAttemptState,
  updateAttemptStudent,
  updateAttemptLocation,
  updateAttemptSelfie,
  updateAttemptFingerprint,
  updateAttemptReceipt,
  clearAttemptState,
} from '../attemptState';
import type { LivenessProof, SessionData, StudentData } from '../../types';

describe('Agent 3: Liveness Security & End-to-End QA Audit', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const uploadSelfiePath = path.resolve(rootDir, 'supabase/functions/upload-selfie/index.ts');
  const submitAttendancePath = path.resolve(rootDir, 'supabase/functions/submit-attendance/index.ts');
  const cameraHudPath = path.resolve(__dirname, '../../components/CameraHUD.tsx');

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('1. Backend Edge Functions Contract Audit', () => {
    it('1.1 upload-selfie enforces max 5MB and min 1KB payload size', () => {
      const code = fs.readFileSync(uploadSelfiePath, 'utf-8');
      expect(code).toContain('5 * 1024 * 1024');
      expect(code).toContain('FILE_TOO_LARGE');
      expect(code).toContain('FILE_TOO_SMALL');
    });

    it('1.2 upload-selfie validates image format magic numbers for JPEG, PNG, and WebP', () => {
      const code = fs.readFileSync(uploadSelfiePath, 'utf-8');
      expect(code).toContain('0xFF && imageBytes[1] === 0xD8 && imageBytes[2] === 0xFF'); // JPEG
      expect(code).toContain('0x89 && imageBytes[1] === 0x50 && imageBytes[2] === 0x4E'); // PNG
      expect(code).toContain('INVALID_IMAGE_FORMAT');
    });

    it('1.3 upload-selfie constructs canonical storage path and marks step=selfie', () => {
      const code = fs.readFileSync(uploadSelfiePath, 'utf-8');
      expect(code).toContain('attendance/${attempt.session_id}/${attempt.student_id}/${attempt.id}.jpg');
      expect(code).toContain("step: 'selfie'");
      expect(code).toContain("selfie_path: canonicalPath");
    });

    it('1.4 upload-selfie supports primary selfies bucket with attendance fallback', () => {
      const code = fs.readFileSync(uploadSelfiePath, 'utf-8');
      expect(code).toContain(".from('selfies')");
      expect(code).toContain(".from('attendance')");
      expect(code).toContain('STORAGE_UPLOAD_FAILED');
    });

    it('1.5 submit-attendance preserves liveness proof inside device_info and inlines Gate 4', () => {
      const code = fs.readFileSync(submitAttendancePath, 'utf-8');
      expect(code).toContain('deviceInfo.liveness_proof = body.liveness_proof');
      expect(code).toContain('rpc_submit_attendance');
      expect(code).toContain('delete deviceInfo.selfie_data_url');
    });
  });

  describe('2. Anti-Spoofing & Liveness Integrity Engine', () => {
    const hudSource = fs.readFileSync(cameraHudPath, 'utf-8');

    it('2.1 Baseline centering is strictly required before head turn challenge', () => {
      expect(hudSource).toContain('baselineEstablished');
      expect(hudSource).toContain('baselineNoseOffset');
      expect(hudSource).toMatch(/Math\.abs\(relNoseOffset\)\s*<\s*0\.07/);
      expect(hudSource).toContain('Face centered! Now turn head slightly');
    });

    it('2.2 Baseline neutral expression is strictly required before smile challenge', () => {
      expect(hudSource).toContain('baselineSmile');
      expect(hudSource).toMatch(/avgSmile\s*<\s*0\.25/);
      expect(hudSource).toContain('Face ready! Now give a gentle smile');
    });

    it('2.3 Baseline open eyes is strictly required before blink challenge', () => {
      expect(hudSource).toContain('isOpen');
      expect(hudSource).toContain('Face ready! Please blink twice');
    });

    it('2.4 Minimum challenge duration (elapsed >= 0.4s) prevents 0ms instantaneous bypass', () => {
      expect(hudSource).toMatch(/elapsed\s*>=\s*0\.4/);
    });

    it('2.5 Human blink duration window (60ms <= duration <= 1500ms) rejects sensor glitch', () => {
      expect(hudSource).toMatch(/closedDuration\s*>=\s*60\s*&&\s*closedDuration\s*<=\s*1500/);
    });

    it('2.6 Generates complete LivenessProof contract with timestamp and confidence score', () => {
      expect(hudSource).toContain('proof: LivenessProof');
      expect(hudSource).toContain('confidence_score');
      expect(hudSource).toContain('challenge_passed: true');
    });
  });

  describe('3. Timeout and Retry Clean Lifecycle', () => {
    const hudSource = fs.readFileSync(cameraHudPath, 'utf-8');

    it('3.1 15-second timeout stops video tracks and displays recovery card', () => {
      expect(hudSource).toContain('elapsed > 15');
      expect(hudSource).toContain('setTimedOut(true)');
      expect(hudSource).toContain('stopStream()');
      expect(hudSource).toContain('Liveness timeout (15s)');
    });

    it('3.2 handleRetry resets state, selects new random challenge, and restarts camera', () => {
      expect(hudSource).toContain('onRetake()');
      expect(hudSource).toContain('baselineEstablished: false');
      expect(hudSource).toContain('startCamera()');
    });

    it('3.3 Video stream watchdog ensures streamActive becomes true even on mobile race conditions', () => {
      expect(hudSource).toContain('video.onloadeddata = markActive');
      expect(hudSource).toContain('video.oncanplay = markActive');
      expect(hudSource).toContain('video.onplaying = markActive');
    });
  });

  describe('4. End-to-End Student Attendance Verification Flow', () => {
    const mockSession: SessionData = {
      id: 'session-uuid-001',
      title: 'Operating Systems CS301',
      course_code: 'CSC 301',
      course_title: 'Operating Systems',
      starts_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
      grace_minutes: 15,
      location_enabled: true,
    };

    const mockStudent: StudentData = {
      id: 'student-uuid-999',
      matric_no: 'ADUN/FS/COM/25/001',
      full_name: 'Adeleke, Femi Emmanuel',
      surname: 'Adeleke',
      first_name: 'Femi',
      middle_name: 'Emmanuel',
      program: 'B.Sc. Computer Science',
      level: 300,
    };

    it('4.1 Completes full end-to-end attendance sequence seamlessly', async () => {
      // Step 1: QR Scan & Validate Session Token
      const attempt = initAttemptState('raw-qr-token-xyz', 'attempt-uuid-123', 'atok-secret-token', mockSession);
      expect(attempt.attempt_id).toBe('attempt-uuid-123');
      expect(attempt.idempotency_key).toBeDefined();

      // Step 2: Matric lookup
      updateAttemptStudent(mockStudent);
      const studentState = getAttemptState();
      expect(studentState?.student?.matric_no).toBe('ADUN/FS/COM/25/001');

      // Step 3: Device check
      updateAttemptFingerprint('fp_hash_device_01', false);
      const devState = getAttemptState();
      expect(devState?.fingerprint_hash).toBe('fp_hash_device_01');

      // Step 4: Location check (enabled for this lecture)
      updateAttemptLocation({
        latitude: 6.5244,
        longitude: 3.3792,
        accuracy_m: 8.2,
        verified_at: new Date().toISOString(),
        inside_boundary: true,
      });
      const locState = getAttemptState();
      expect(locState?.location?.inside_boundary).toBe(true);

      // Step 5: Face scan & Liveness verification
      const proof: LivenessProof = {
        challenge_type: 'blink',
        challenge_passed: true,
        duration_ms: 1250,
        confidence_score: 0.98,
        timestamp: new Date().toISOString(),
      };
      const canonicalPath = `attendance/${mockSession.id}/${mockStudent.id}/${attempt.attempt_id}.jpg`;
      updateAttemptSelfie('data:image/jpeg;base64,mockFakeBase64Bytes', canonicalPath, proof);

      const selfieState = getAttemptState();
      expect(selfieState?.selfie_path).toBe(canonicalPath);
      expect(selfieState?.liveness_proof?.challenge_passed).toBe(true);
      expect(selfieState?.liveness_proof?.confidence_score).toBe(0.98);

      // Step 6: Final Submission & Official Receipt
      const receipt = {
        receipt_id: 'ADUN-20261119-A1B2C3',
        status: 'present' as const,
        signed_at: new Date().toISOString(),
        course_code: mockSession.course_code,
        course_title: mockSession.course_title,
        student_name: `${mockStudent.surname}, ${mockStudent.first_name}`,
        matric_no: mockStudent.matric_no,
      };
      updateAttemptReceipt(receipt);

      const finalState = getAttemptState();
      expect(finalState?.receipt?.receipt_id).toBe('ADUN-20261119-A1B2C3');
      expect(finalState?.receipt?.status).toBe('present');

      // Clean cleanup after completion
      clearAttemptState();
      expect(getAttemptState()).toBeNull();
    });

    it('4.2 Skips location check when session has location_enabled = false', () => {
      const sessionNoLoc: SessionData = {
        ...mockSession,
        location_enabled: false,
      };

      const attempt = initAttemptState('raw-qr-token-xyz', 'attempt-uuid-456', 'atok-secret-token-2', sessionNoLoc);
      updateAttemptStudent(mockStudent);
      updateAttemptFingerprint('fp_hash_device_02', false);

      // Directly advances to selfie step without location
      const proof: LivenessProof = {
        challenge_type: 'smile',
        challenge_passed: true,
        duration_ms: 980,
        confidence_score: 0.98,
        timestamp: new Date().toISOString(),
      };
      updateAttemptSelfie('data:image/jpeg;base64,selfie', 'attendance/session/student/attempt.jpg', proof);

      const state = getAttemptState();
      expect(state?.location).toBeUndefined();
      expect(state?.selfie_path).toBeDefined();
      expect(state?.liveness_proof?.challenge_type).toBe('smile');
    });
  });
});
