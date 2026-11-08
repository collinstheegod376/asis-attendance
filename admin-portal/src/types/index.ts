export type UserRole = 'admin' | 'lecturer';
export type UserStatus = 'active' | 'soft_deleted';
export type CourseStatus = 'active' | 'archived';
export type SessionStatus = 'scheduled' | 'active' | 'expired' | 'closed' | 'revoked';
export type AttendanceStatus = 'present' | 'late';
export type VerificationStatus = 'passed' | 'manual_review';
export type LocationMode = 'enforce' | 'evidence_only';
export type BindingStatus = 'active' | 'reset' | 'revoked';
export type ProxyRiskLevel = 'low' | 'medium' | 'high';

export type DeviceEventType =
  | 'bind'
  | 'match'
  | 'mismatch'
  | 'cookie_missing'
  | 'cookie_mismatch'
  | 'admin_reset'
  | 'proxy_detected'
  | 'device_reset'
  | 'device_bound'
  | 'binding_conflict'
  | 'proxy_flagged';

export interface User {
  id: string;
  role: UserRole;
  username: string;
  email: string;
  name: string;
  department?: string;
  staff_id?: string;
  status: UserStatus;
  must_change_password: boolean;
  password?: string;
  created_at: string;
  deleted_at?: string | null;
}

export interface StudentMaster {
  id: string;
  matric_no: string;
  search_key: string; // last 3 digits helper
  surname: string;
  first_name: string;
  middle_name?: string;
  program: string;
  level: string; // 100, 200, 300, 400, 500
  email?: string;
  phone?: string;
  status: 'active' | 'inactive';
  created_at: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  lecturer_id: string;
  lecturer_name?: string;
  department?: string;
  status: CourseStatus;
  created_at: string;
  archived_at?: string | null;
  enrolled_count?: number;
  sessions_count?: number;
}

export interface CourseRoster {
  id: string;
  course_id: string;
  student_id: string;
  matric_no: string;
  student_name: string;
  program?: string;
  level?: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface LectureSession {
  id: string;
  course_id: string;
  course_code?: string;
  course_title?: string;
  lecturer_id?: string;
  lecturer_name?: string;
  title: string;
  token_hash: string;
  raw_token?: string;
  starts_at: string;
  expires_at: string;
  duration_minutes: number;
  grace_minutes: number;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  closed_at?: string | null;
  attendance_count?: number;
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  session_title?: string;
  course_id: string;
  course_code?: string;
  course_title?: string;
  student_id: string;
  matric_no: string;
  student_name: string;
  program?: string;
  level?: string;
  signed_at: string;
  status: AttendanceStatus;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  selfie_path?: string;
  selfie_url?: string;
  verification_status: VerificationStatus;
  device_info?: string;
  receipt_id: string;
  proxy_risk?: ProxyRiskLevel;
  fingerprint_snapshot_ref?: string;
  device_id?: string;
}

export interface DeviceEvent {
  id: string;
  student_id: string;
  matric_no: string;
  event_type: DeviceEventType;
  reference_code: string; // e.g. BIND-201, BIND-204, BIND-205
  ip_address: string;
  user_agent?: string;
  device_id?: string;
  actor_id?: string;
  actor_name?: string;
  actor_role?: UserRole | 'system';
  reason?: string;
  metadata?: {
    reason?: string;
    admin_id?: string;
    admin_name?: string;
    browser?: string;
    os?: string;
    previous_status?: string;
    new_status?: string;
    is_shared?: boolean;
    cookie_id?: string;
    [key: string]: any;
  };
  created_at: string;
}

export interface DeviceBinding {
  id: string;
  device_id: string;
  device_fingerprint_hash?: string;
  student_id: string;
  matric_no: string;
  student_name: string;
  matric_hash: string;
  user_agent?: string;
  browser?: string;
  os?: string;
  ip_address?: string;
  first_bound_at: string;
  last_seen_at: string;
  status: BindingStatus;
  is_shared?: boolean;
  shared_reason?: string;
  shared_updated_at?: string;
  shared_updated_by?: string;
  reset_by?: string | null;
  reset_at?: string | null;
  reset_reason?: string | null;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_name: string;
  actor_role: UserRole | 'system';
  action: string;
  entity: string;
  entity_id?: string;
  reference_code?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface SystemSettings {
  location_mode: LocationMode;
  campus_boundary_geojson?: string;
  campus_center_lat: number;
  campus_center_lng: number;
  campus_radius_m: number;
  location_accuracy_threshold_m: number;
  default_session_duration_minutes: number;
  max_session_duration_minutes: number;
  selfie_retention_days: number;
  grace_minutes: number;
  max_active_courses_per_lecturer: number;
  rate_limit_token_per_minute: number;
  rate_limit_matric_per_minute: number;
  updated_at: string;
  updated_by?: string;
}
