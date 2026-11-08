export type AttemptStep = 'identity' | 'location' | 'selfie' | 'video' | 'submitted';
export type AttendanceStatus = 'present' | 'late';
export type VerificationStatus = 'passed' | 'manual_review';
export type LocationMode = 'enforce' | 'evidence_only';

export interface SessionData {
  id: string;
  title: string;
  course_code: string;
  course_title: string;
  starts_at: string;
  expires_at: string;
  grace_minutes: number;
}

export interface StudentData {
  id: string;
  matric_no: string;
  surname: string;
  first_name: string;
  middle_name: string | null;
  program: string;
  level: number;
}

export interface AttemptSessionState {
  attempt_id: string;
  attempt_token: string;
  raw_token: string;
  session: SessionData;
  student?: StudentData;
  location?: {
    latitude: number;
    longitude: number;
    accuracy_m: number;
    verified_at: string;
    inside_boundary?: boolean;
  };
  selfie_data_url?: string;
  selfie_path?: string;
  video_watched?: boolean;
  fingerprint_hash?: string;
  is_incognito?: boolean;
  receipt?: AttendanceReceipt;
}

export interface AttendanceReceipt {
  receipt_id: string;
  status: AttendanceStatus;
  signed_at: string;
  course_code: string;
  course_title: string;
  student_name: string;
  matric_no: string;
  selfie_preview?: string;
}

export interface DeviceBinding {
  device_id: string;
  matric_hash: string;
  first_bound_at: string;
  last_seen_at: string;
}
