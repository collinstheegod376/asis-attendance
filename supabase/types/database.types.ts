/**
 * ADUN Attendance System - Database TypeScript Definitions
 * Admiralty University of Nigeria
 * Generated for Supabase schema version: 20261108000000 (Option 2 Strict Device Binding)
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'admin' | 'lecturer';
export type UserStatus = 'active' | 'soft_deleted';
export type CourseStatus = 'active' | 'archived';
export type SessionStatus = 'scheduled' | 'active' | 'expired' | 'closed' | 'revoked';
export type AttemptStep = 'identity' | 'location' | 'selfie' | 'video' | 'submitted';
export type AttendanceStatus = 'present' | 'late';
export type VerificationStatus = 'passed' | 'manual_review';
export type DeviceBindingStatus = 'active' | 'reset' | 'revoked';
export type DeviceEventType =
  | 'bind'
  | 'match'
  | 'mismatch'
  | 'cookie_missing'
  | 'cookie_mismatch'
  | 'admin_reset'
  | 'proxy_detected';
export type ProxyRiskLevel = 'low' | 'medium' | 'high';
export type LocationMode = 'enforce' | 'evidence_only';

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          role: UserRole;
          username: string;
          email: string;
          password_hash: string;
          auth_id: string | null;
          status: UserStatus;
          must_change_password: boolean;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          role?: UserRole;
          username: string;
          email: string;
          password_hash: string;
          auth_id?: string | null;
          status?: UserStatus;
          must_change_password?: boolean;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          role?: UserRole;
          username?: string;
          email?: string;
          password_hash?: string;
          auth_id?: string | null;
          status?: UserStatus;
          must_change_password?: boolean;
          created_at?: string;
          deleted_at?: string | null;
        };
      };
      students_master: {
        Row: {
          id: string;
          matric_no: string;
          search_key: string;
          surname: string;
          first_name: string;
          middle_name: string | null;
          program: string;
          level: number;
          email: string | null;
          phone: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          matric_no: string;
          search_key?: string;
          surname: string;
          first_name: string;
          middle_name?: string | null;
          program: string;
          level: number;
          email?: string | null;
          phone?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          matric_no?: string;
          search_key?: string;
          surname?: string;
          first_name?: string;
          middle_name?: string | null;
          program?: string;
          level?: number;
          email?: string | null;
          phone?: string | null;
          status?: string;
          created_at?: string;
        };
      };
      courses: {
        Row: {
          id: string;
          code: string;
          title: string;
          lecturer_id: string;
          status: CourseStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          title: string;
          lecturer_id: string;
          status?: CourseStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          title?: string;
          lecturer_id?: string;
          status?: CourseStatus;
          created_at?: string;
        };
      };
      course_roster: {
        Row: {
          id: string;
          course_id: string;
          student_id: string;
          uploaded_by: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          student_id: string;
          uploaded_by: string;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          course_id?: string;
          student_id?: string;
          uploaded_by?: string;
          uploaded_at?: string;
        };
      };
      lecture_sessions: {
        Row: {
          id: string;
          course_id: string;
          title: string;
          token_hash: string;
          starts_at: string;
          expires_at: string;
          grace_minutes: number;
          status: SessionStatus;
          created_by: string;
          created_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          course_id: string;
          title: string;
          token_hash: string;
          starts_at: string;
          expires_at: string;
          grace_minutes?: number;
          status?: SessionStatus;
          created_by: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          course_id?: string;
          title?: string;
          token_hash?: string;
          starts_at?: string;
          expires_at?: string;
          grace_minutes?: number;
          status?: SessionStatus;
          created_by?: string;
          created_at?: string;
          closed_at?: string | null;
        };
      };
      attendance_attempts: {
        Row: {
          id: string;
          session_id: string;
          student_id: string | null;
          attempt_token_hash: string;
          step: AttemptStep;
          matric_hash: string | null;
          device_id: string | null;
          fingerprint_hash: string | null;
          binding_id: string | null;
          latitude: number | null;
          longitude: number | null;
          accuracy_m: number | null;
          selfie_path: string | null;
          video_seen: boolean;
          expires_at: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          student_id?: string | null;
          attempt_token_hash: string;
          step?: AttemptStep;
          matric_hash?: string | null;
          device_id?: string | null;
          fingerprint_hash?: string | null;
          binding_id?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          accuracy_m?: number | null;
          selfie_path?: string | null;
          video_seen?: boolean;
          expires_at?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          student_id?: string | null;
          attempt_token_hash?: string;
          step?: AttemptStep;
          matric_hash?: string | null;
          device_id?: string | null;
          fingerprint_hash?: string | null;
          binding_id?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          accuracy_m?: number | null;
          selfie_path?: string | null;
          video_seen?: boolean;
          expires_at?: string;
          created_at?: string;
          completed_at?: string | null;
        };
      };
      attendance_records: {
        Row: {
          id: string;
          session_id: string;
          course_id: string;
          student_id: string;
          signed_at: string;
          status: AttendanceStatus;
          latitude: number | null;
          longitude: number | null;
          accuracy_m: number | null;
          selfie_path: string;
          verification_status: VerificationStatus;
          device_info: Json | null;
          receipt_id: string;
          idempotency_key: string | null;
          fingerprint_hash: string | null;
          binding_id: string | null;
          proxy_risk: ProxyRiskLevel;
        };
        Insert: {
          id?: string;
          session_id: string;
          course_id: string;
          student_id: string;
          signed_at?: string;
          status: AttendanceStatus;
          latitude?: number | null;
          longitude?: number | null;
          accuracy_m?: number | null;
          selfie_path: string;
          verification_status?: VerificationStatus;
          device_info?: Json | null;
          receipt_id: string;
          idempotency_key?: string | null;
          fingerprint_hash?: string | null;
          binding_id?: string | null;
          proxy_risk?: ProxyRiskLevel;
        };
        Update: {
          id?: string;
          session_id?: string;
          course_id?: string;
          student_id?: string;
          signed_at?: string;
          status?: AttendanceStatus;
          latitude?: number | null;
          longitude?: number | null;
          accuracy_m?: number | null;
          selfie_path?: string;
          verification_status?: VerificationStatus;
          device_info?: Json | null;
          receipt_id?: string;
          idempotency_key?: string | null;
          fingerprint_hash?: string | null;
          binding_id?: string | null;
          proxy_risk?: ProxyRiskLevel;
        };
      };
      device_bindings: {
        Row: {
          id: string;
          student_id: string;
          fingerprint_hash: string;
          device_id: string | null;
          trusted_cookie_hash: string | null;
          user_agent: string | null;
          first_bound_at: string;
          last_seen_at: string;
          status: DeviceBindingStatus;
          is_shared: boolean;
          reset_by: string | null;
          reset_at: string | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          fingerprint_hash: string;
          device_id?: string | null;
          trusted_cookie_hash?: string | null;
          user_agent?: string | null;
          first_bound_at?: string;
          last_seen_at?: string;
          status?: DeviceBindingStatus;
          is_shared?: boolean;
          reset_by?: string | null;
          reset_at?: string | null;
        };
        Update: {
          id?: string;
          student_id?: string;
          fingerprint_hash?: string;
          device_id?: string | null;
          trusted_cookie_hash?: string | null;
          user_agent?: string | null;
          first_bound_at?: string;
          last_seen_at?: string;
          status?: DeviceBindingStatus;
          is_shared?: boolean;
          reset_by?: string | null;
          reset_at?: string | null;
        };
      };
      device_events: {
        Row: {
          id: string;
          student_id: string | null;
          fingerprint_hash: string;
          event_type: DeviceEventType;
          reference_code: string;
          metadata: Json | null;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          student_id?: string | null;
          fingerprint_hash: string;
          event_type: DeviceEventType;
          reference_code: string;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string | null;
          fingerprint_hash?: string;
          event_type?: DeviceEventType;
          reference_code?: string;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_role: string;
          action: string;
          entity: string;
          entity_id: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_role: string;
          action: string;
          entity: string;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          actor_role?: string;
          action?: string;
          entity?: string;
          entity_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
      };
      settings: {
        Row: {
          id: number;
          location_mode: LocationMode;
          campus_boundary_geojson: Json | null;
          location_accuracy_threshold_m: number;
          default_session_duration_minutes: number;
          max_session_duration_minutes: number;
          selfie_retention_days: number;
          grace_minutes: number;
          max_active_courses_per_lecturer: number;
          rate_limit_token_per_minute: number;
          rate_limit_matric_per_minute: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          location_mode?: LocationMode;
          campus_boundary_geojson?: Json | null;
          location_accuracy_threshold_m?: number;
          default_session_duration_minutes?: number;
          max_session_duration_minutes?: number;
          selfie_retention_days?: number;
          grace_minutes?: number;
          max_active_courses_per_lecturer?: number;
          rate_limit_token_per_minute?: number;
          rate_limit_matric_per_minute?: number;
          updated_at?: string;
        };
        Update: {
          id?: number;
          location_mode?: LocationMode;
          campus_boundary_geojson?: Json | null;
          location_accuracy_threshold_m?: number;
          default_session_duration_minutes?: number;
          max_session_duration_minutes?: number;
          selfie_retention_days?: number;
          grace_minutes?: number;
          max_active_courses_per_lecturer?: number;
          rate_limit_token_per_minute?: number;
          rate_limit_matric_per_minute?: number;
          updated_at?: string;
        };
      };
    };
    Functions: {
      rpc_validate_session_token: {
        Args: {
          p_raw_token: string;
        };
        Returns: Json;
      };
      rpc_lookup_matric: {
        Args: {
          p_attempt_id: string;
          p_attempt_token: string;
          p_raw_matric: string;
          p_device_id?: string | null;
          p_fingerprint_hash?: string | null;
        };
        Returns: Json;
      };
      rpc_device_check: {
        Args: {
          p_student_id: string;
          p_fingerprint_hash: string;
          p_cookie_token_hash?: string | null;
          p_local_device_id?: string | null;
          p_incognito_signal?: boolean;
          p_user_agent?: string | null;
          p_ip?: string | null;
        };
        Returns: Json;
      };
      rpc_verify_location: {
        Args: {
          p_attempt_id: string;
          p_attempt_token: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy_m: number;
        };
        Returns: Json;
      };
      rpc_submit_attendance: {
        Args: {
          p_attempt_id: string;
          p_attempt_token: string;
          p_selfie_path: string;
          p_device_info?: Json;
          p_idempotency_key?: string | null;
          p_fingerprint_hash?: string | null;
          p_binding_id?: string | null;
        };
        Returns: Json;
      };
      rpc_reset_device_binding: {
        Args: {
          p_student_id: string;
          p_actor_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
    };
  };
}

/**
 * Standard Decision Actions returned by rpc_device_check
 */
export type DeviceCheckAction = 'OK' | 'BOUND' | 'CONTACT_ADMIN' | 'OPEN_NORMAL_BROWSER';

export interface DeviceCheckResult {
  success: boolean;
  allowed: boolean;
  action: DeviceCheckAction;
  status: number;
  error?: string;
  reason?: string;
  reference_code: string;
  binding_id?: string;
  is_new_binding?: boolean;
  is_shared?: boolean;
  trusted_device_token?: string;
  fingerprint_hash?: string;
}

/**
 * Standard API Response Structures for Student Check-in Flow
 */
export interface SessionValidationResult {
  success: boolean;
  attempt_id?: string;
  attempt_token?: string;
  error?: 'INVALID_TOKEN' | 'COURSE_ARCHIVED' | 'SESSION_CLOSED' | 'SESSION_NOT_STARTED' | 'SESSION_EXPIRED';
  message?: string;
  session?: {
    id: string;
    title: string;
    course_code: string;
    course_title: string;
    starts_at: string;
    expires_at: string;
    grace_minutes: number;
  };
}

export interface StudentIdentityResult {
  success: boolean;
  error?:
    | 'BAD_REQUEST'
    | 'INVALID_ATTEMPT'
    | 'ATTEMPT_EXPIRED'
    | 'SESSION_EXPIRED'
    | 'STUDENT_NOT_FOUND'
    | 'NOT_ON_ROSTER'
    | 'ALREADY_SIGNED'
    | 'DEVICE_REGISTERED_TO_ANOTHER';
  message?: string;
  student?: {
    id: string;
    matric_no: string;
    surname: string;
    first_name: string;
    middle_name: string | null;
    program: string;
    level: number;
  };
  signed_at?: string;
  receipt_id?: string;
}

export interface LocationVerificationResult {
  success: boolean;
  error?: 'ATTEMPT_EXPIRED' | 'LOW_ACCURACY' | 'OUTSIDE_CAMPUS_BOUNDARY';
  message?: string;
  location_mode?: LocationMode;
  inside_boundary?: boolean;
  accuracy_valid?: boolean;
  accuracy_m?: number;
  threshold_m?: number;
}

export interface AttendanceSubmissionResult {
  success: boolean;
  error?:
    | 'INVALID_ATTEMPT'
    | 'ATTEMPT_EXPIRED'
    | 'IDENTITY_MISSING'
    | 'SELFIE_REQUIRED'
    | 'SESSION_EXPIRED'
    | 'ALREADY_SIGNED'
    | 'PROXY_DETECTED';
  message?: string;
  reason?: string;
  reference_code?: string;
  receipt_id?: string;
  status?: AttendanceStatus;
  proxy_risk?: ProxyRiskLevel;
  signed_at?: string;
  course_code?: string;
  course_title?: string;
  student_name?: string;
  matric_no?: string;
  is_idempotent_replay?: boolean;
}

export interface DeviceBindingResetResult {
  success: boolean;
  error?: 'UNAUTHORIZED' | 'REASON_REQUIRED' | 'RATE_LIMIT_EXCEEDED' | string;
  message?: string;
  reset_count?: number;
  student_id?: string;
  reference_code?: string;
}
