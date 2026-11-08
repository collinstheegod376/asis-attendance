/**
 * ADUN Attendance - Attendance Service
 * Implements business logic for session validation, identity check, location verification,
 * atomic attendance recording, receipt generation, and selfie signed URL retrieval.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  SessionValidationResult,
  StudentIdentityResult,
  LocationVerificationResult,
  AttendanceSubmissionResult,
} from '../types/database.types.ts';
import { normalizeMatric } from '../functions/_shared/crypto.ts';

export class AttendanceService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Validates a lecture session raw token and creates an ephemeral attempt
   */
  async validateSessionToken(rawToken: string): Promise<SessionValidationResult> {
    if (!rawToken || !rawToken.trim()) {
      return { success: false, error: 'INVALID_TOKEN', message: 'Token cannot be empty' };
    }

    const { data, error } = await this.supabase.rpc('rpc_validate_session_token', {
      p_raw_token: rawToken.trim(),
    });

    if (error) {
      throw new Error(`Database error validating session: ${error.message}`);
    }

    return data as unknown as SessionValidationResult;
  }

  /**
   * Looks up student by normalized matric, checks roster enrollment and device binding hint
   */
  async lookupMatric(
    attemptId: string,
    attemptToken: string,
    matricNo: string,
    deviceId: string = '',
    fingerprintHash?: string
  ): Promise<StudentIdentityResult> {
    const cleanMatric = normalizeMatric(matricNo);

    const { data, error } = await this.supabase.rpc('rpc_lookup_matric', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_raw_matric: cleanMatric,
      p_device_id: deviceId || null,
      p_fingerprint_hash: fingerprintHash || null,
    });

    if (error) {
      throw new Error(`Database error looking up matric: ${error.message}`);
    }

    return data as unknown as StudentIdentityResult;
  }

  /**
   * Verifies student geolocation against campus boundary GeoJSON & accuracy threshold
   */
  async verifyLocation(
    attemptId: string,
    attemptToken: string,
    latitude: number,
    longitude: number,
    accuracyM: number
  ): Promise<LocationVerificationResult> {
    const { data, error } = await this.supabase.rpc('rpc_verify_location', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM,
    });

    if (error) {
      throw new Error(`Database error verifying location: ${error.message}`);
    }

    return data as unknown as LocationVerificationResult;
  }

  /**
   * Submits attendance atomically, issues receipt, updates attempt and links device binding
   */
  async submitAttendance(
    attemptId: string,
    attemptToken: string,
    selfiePath: string,
    deviceInfo: Record<string, unknown> = {},
    idempotencyKey?: string,
    fingerprintHash?: string,
    bindingId?: string
  ): Promise<AttendanceSubmissionResult> {
    const { data, error } = await this.supabase.rpc('rpc_submit_attendance', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_selfie_path: selfiePath,
      p_device_info: deviceInfo as any,
      p_idempotency_key: idempotencyKey || null,
      p_fingerprint_hash: fingerprintHash || null,
      p_binding_id: bindingId || null,
    });

    if (error) {
      throw new Error(`Database error submitting attendance: ${error.message}`);
    }

    return data as unknown as AttendanceSubmissionResult;
  }

  /**
   * Generates a short-lived signed URL for lecturer/admin viewing of student selfie evidence
   */
  async getSignedSelfieUrl(selfiePath: string, expiresInSeconds: number = 300): Promise<string> {
    if (!selfiePath) return '';

    // Remove bucket prefix if present
    const cleanPath = selfiePath.replace(/^selfies\//, '');

    const { data, error } = await this.supabase.storage
      .from('selfies')
      .createSignedUrl(cleanPath, expiresInSeconds);

    if (error) {
      throw new Error(`Failed to generate signed URL for selfie: ${error.message}`);
    }

    return data.signedUrl;
  }

  /**
   * Fetches attendance summary statistics for a session
   */
  async getSessionAttendanceSummary(sessionId: string) {
    const { data, error } = await this.supabase
      .from('attendance_records')
      .select('status, verification_status, proxy_risk, signed_at')
      .eq('session_id', sessionId);

    if (error) {
      throw new Error(`Failed to fetch session attendance records: ${error.message}`);
    }

    const records = data || [];
    const present = records.filter((r) => r.status === 'present').length;
    const late = records.filter((r) => r.status === 'late').length;
    const manualReview = records.filter((r) => r.verification_status === 'manual_review').length;
    const highRisk = records.filter((r) => r.proxy_risk === 'high').length;
    const mediumRisk = records.filter((r) => r.proxy_risk === 'medium').length;

    return {
      total: records.length,
      present,
      late,
      manualReview,
      highRisk,
      mediumRisk,
      records,
    };
  }
}
