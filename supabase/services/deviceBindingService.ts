/**
 * ADUN Attendance - Strict Device Binding Service (Option 2)
 * Manages device bindings, forensic device events, anti-proxy verification,
 * and controlled reset operations for Lecturers and Admins.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Database,
  DeviceCheckResult,
  DeviceBindingResetResult,
} from '../types/database.types.ts';

export interface DeviceCheckParams {
  studentId: string;
  fingerprintHash: string;
  cookieTokenHash?: string | null;
  localDeviceId?: string | null;
  incognitoSignal?: boolean;
  userAgent?: string | null;
  ip?: string | null;
}

export class DeviceBindingService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Authoritative server-side device check (GATE 1 and GATE 4).
   * Evaluates physical fingerprint uniqueness, HMAC cookie continuity,
   * localStorage device UUID, and incognito status.
   */
  async checkDevice(params: DeviceCheckParams): Promise<DeviceCheckResult> {
    const { data, error } = await this.supabase.rpc('rpc_device_check', {
      p_student_id: params.studentId,
      p_fingerprint_hash: params.fingerprintHash,
      p_cookie_token_hash: params.cookieTokenHash ?? null,
      p_local_device_id: params.localDeviceId ?? null,
      p_incognito_signal: params.incognitoSignal ?? false,
      p_user_agent: params.userAgent ?? null,
      p_ip: params.ip ?? null,
    });

    if (error) {
      throw new Error(`Database error executing device check: ${error.message}`);
    }

    return data as unknown as DeviceCheckResult;
  }

  /**
   * Resets active device lock for a student.
   * Reason is mandatory for institutional compliance and audit logging.
   */
  async resetBinding(
    studentId: string,
    actorId: string,
    reason: string
  ): Promise<DeviceBindingResetResult> {
    if (!reason || !reason.trim()) {
      throw new Error('A reason is mandatory for resetting a student device binding.');
    }

    const { data, error } = await this.supabase.rpc('rpc_reset_device_binding', {
      p_student_id: studentId,
      p_actor_id: actorId,
      p_reason: reason.trim(),
    });

    if (error) {
      throw new Error(`Failed to reset device binding: ${error.message}`);
    }

    return data as unknown as DeviceBindingResetResult;
  }

  /**
   * Retrieves current active device binding for a student
   */
  async getActiveBinding(studentId: string) {
    const { data, error } = await this.supabase
      .from('device_bindings')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch active device binding: ${error.message}`);
    }

    return data;
  }

  /**
   * Fetches forensic device events for a student (e.g. for Admin Settings review)
   */
  async getStudentDeviceEvents(studentId: string, limit = 20) {
    const { data, error } = await this.supabase
      .from('device_events')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch student device events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Flags or unflags a binding as shared (e.g. siblings sharing a phone).
   * Shared bindings raise proxy_risk to 'medium' on every attendance record.
   */
  async setSharedFlag(bindingId: string, isShared: boolean, actorId: string) {
    const { data, error } = await this.supabase
      .from('device_bindings')
      .update({ is_shared: isShared })
      .eq('id', bindingId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update shared binding status: ${error.message}`);
    }

    // Write administrative audit log
    await this.supabase.from('audit_logs').insert({
      actor_id: actorId,
      actor_role: 'admin',
      action: isShared ? 'DEVICE_BINDING_MARKED_SHARED' : 'DEVICE_BINDING_UNMARKED_SHARED',
      entity: 'device_bindings',
      entity_id: bindingId,
      metadata: { is_shared: isShared },
    });

    return data;
  }

  /**
   * Fetches recent suspicious proxy incidents (proxy_detected, mismatch, cookie_missing)
   */
  async getSuspiciousIncidents(limit = 50) {
    const { data, error } = await this.supabase
      .from('device_events')
      .select('*, students_master(matric_no, surname, first_name)')
      .in('event_type', ['proxy_detected', 'mismatch', 'cookie_mismatch'])
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch proxy incidents: ${error.message}`);
    }

    return data || [];
  }
}
