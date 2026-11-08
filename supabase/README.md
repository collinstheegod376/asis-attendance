# ADUN Attendance — Backend & Database Engine

Architecture and backend engine for **ADUN Attendance** (Admiralty University of Nigeria Attendance System).

---

## 1. Zero Demo Data Policy

> **CRITICAL COMPLIANCE NOTICE**:
> This database contains **ZERO dummy or mock students, courses, rosters, or attendance records**.
> The database initialization includes strictly:
> 1. The mandatory seed admin account (`admin` / `admin` with `must_change_password = true`).
> 2. Institutional default system configuration settings.

---

## 2. System Architecture & Decisions

- **Institutional Timezone**: Standardized on `Africa/Lagos` (GMT+1) for all attendance records, receipts, and grace period calculations.
- **Session Tokens**: Never stored in plaintext. Raw high-entropy tokens are SHA-256 hashed immediately and verified server-side.
- **Roster Eligibility**: Only students registered in `students_master` and actively enrolled in `course_roster` by their lecturer can sign attendance.
- **Course Limit**: Strict database trigger enforces a maximum of **9 active courses** per lecturer (`trg_courses_max_active`).
- **Device Binding**: Soft binding binds a student's matric hash to their `device_id` in `localStorage` and `device_bindings` table to deter sharing phones in the lecture hall.
- **Selfie Evidence**: Stored in a private Supabase Storage bucket (`selfies`), accessible only via short-lived signed URLs (default 300s TTL) for lecturers and admins. No public access.
- **Receipt Generation**: Atomic, cryptographically signed format: `ADUN-YYYYMMDD-XXXXXX`.

---

## 3. Database Schema Overview

The database migration is located at:
`supabase/migrations/20261108000000_adun_attendance_schema.sql`

### Tables Summary

| Table | Description | Key Constraints & Triggers |
| :--- | :--- | :--- |
| `users` | Admin and lecturer user profiles | Roles: `admin`, `lecturer`. Status: `active`, `soft_deleted`. |
| `students_master` | Institution-wide master directory | Unique `matric_no`. Auto-generated `search_key` (last 3 digits). |
| `courses` | Academic subjects | Enforces max 9 active courses per lecturer via trigger. |
| `course_roster` | Authorized student list per course | Unique `(course_id, student_id)`. |
| `lecture_sessions` | Time-boxed attendance windows | Unique `token_hash`, `starts_at`, `expires_at`, `grace_minutes`. |
| `attendance_attempts` | Ephemeral 15-minute student session | Steps: `identity` → `location` → `selfie` → `video` → `submitted`. |
| `attendance_records` | Signed immutable attendance records | Unique `(session_id, student_id)`. Idempotency key protection. |
| `device_bindings` | Soft hardware/matric binding | Unique per device and matric hash. Reset by admin/lecturer. |
| `audit_logs` | Immutable audit trail | Append-only. Records actor, action, entity, metadata. |
| `settings` | System configuration singleton | Duration limits, geofence GeoJSON, accuracy threshold, grace minutes. |

---

## 4. Default Seed Credentials

| Property | Value | Notes |
| :--- | :--- | :--- |
| **Username** | `admin` | Fixed seed identifier |
| **Email** | `admin@adun.edu.ng` | Seed administrator email |
| **Password** | `admin` | Hashed with Blowfish / Bcrypt |
| **Role** | `admin` | Full system privileges |
| **Must Change Password** | `true` | Forced password reset required on first sign-in |

---

## 5. Row Level Security (RLS) & Protection

- **Anonymous (`anon`) Role**: Denied direct access to `students_master`, `courses`, `course_roster`, `lecture_sessions`, `attendance_attempts`, `attendance_records`, `device_bindings`, and `audit_logs`.
- **Student Check-in**: Exclusively executed through secure Edge Functions and transactional PostgreSQL RPC functions (`rpc_validate_session_token`, `rpc_lookup_matric`, `rpc_verify_location`, `rpc_submit_attendance`).
- **Lecturers**:
  - Full read/write management of their own courses, sessions, and rosters.
  - Read-only access to attendance records for their own courses.
  - **CANNOT update or delete attendance records or selfies.**
- **Admins**:
  - Full visibility into all courses, sessions, attendance, analytics, audit logs, and settings.
  - Cannot access student credentials (students have no passwords; identified by matric).

---

## 6. Edge Functions & API Contracts

All Edge Functions reside in `supabase/functions/` and are built for Deno/TypeScript.

### 1. `POST /functions/v1/validate-session-token`
- **Request Body**:
  ```json
  { "token": "raw-lecture-session-token" }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "attempt_id": "uuid",
    "attempt_token": "random-256bit-hex",
    "session": {
      "id": "uuid",
      "title": "CSC 401 Lecture 1",
      "course_code": "CSC 401",
      "course_title": "Distributed Systems",
      "starts_at": "2026-11-08T08:00:00Z",
      "expires_at": "2026-11-08T09:00:00Z",
      "grace_minutes": 10
    }
  }
  ```

### 2. `POST /functions/v1/lookup-matric`
- **Request Body**:
  ```json
  {
    "attempt_id": "uuid",
    "attempt_token": "attempt-token-hex",
    "matric_no": "ADUN/FS/COM/25/001",
    "device_id": "uuid-from-localstorage"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "student": {
      "id": "uuid",
      "matric_no": "ADUN/FS/COM/25/001",
      "surname": "Doe",
      "first_name": "John",
      "middle_name": "Ada",
      "program": "Computer Science",
      "level": 400
    }
  }
  ```

### 3. `POST /functions/v1/verify-location`
- **Request Body**:
  ```json
  {
    "attempt_id": "uuid",
    "attempt_token": "attempt-token-hex",
    "latitude": 6.3382,
    "longitude": 5.6258,
    "accuracy_m": 12.5
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "location_mode": "evidence_only",
    "inside_boundary": true,
    "accuracy_valid": true,
    "accuracy_m": 12.5
  }
  ```

### 4. `POST /functions/v1/submit-attendance`
- **Request Body**:
  ```json
  {
    "attempt_id": "uuid",
    "attempt_token": "attempt-token-hex",
    "selfie_path": "attendance/session-id/student-id/attempt-id.jpg",
    "device_info": { "userAgent": "..." },
    "idempotency_key": "uuid"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "receipt_id": "ADUN-20261108-A4F82B",
    "status": "present",
    "signed_at": "2026-11-08T08:05:22.000Z",
    "course_code": "CSC 401",
    "course_title": "Distributed Systems",
    "student_name": "Doe John",
    "matric_no": "ADUN/FS/COM/25/001"
  }
  ```

### 5. `POST /functions/v1/reset-device-binding`
- **Headers**: `Authorization: Bearer <lecturer-or-admin-jwt>`
- **Request Body**:
  ```json
  {
    "student_id": "uuid",
    "reason": "Student phone replaced"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "reset_count": 1,
    "student_id": "uuid"
  }
  ```

---

## 7. TypeScript Services & Direct Import

TypeScript services are located in `supabase/services/` for use in Next.js, Node.js, and admin backends:
- `AttendanceService`: Session validation, location check, attendance recording, signed selfie URL generation.
- `SessionService`: Course session creation with duration constraints, token generation, closing/revocation.
- `RosterService`: Roster spreadsheet parser, master list matching, append/replace management, rejection reports.
- `DeviceBindingService`: Device lock verification and reset procedures.
- `GeoService`: Haversine distance and GeoJSON ray-casting point-in-polygon verification.
- `AuditService`: Append-only audit trail logger and query interface.

Importing services:
```typescript
import { AttendanceService, SessionService, RosterService } from '../supabase/services';
```

---

## 8. Deployment & Local Setup

### Running with Supabase CLI
```bash
# 1. Start local Supabase container stack
npx supabase start

# 2. Apply database migrations
npx supabase db reset

# 3. Deploy Edge Functions
npx supabase functions deploy validate-session-token
npx supabase functions deploy lookup-matric
npx supabase functions deploy verify-location
npx supabase functions deploy submit-attendance
npx supabase functions deploy reset-device-binding
```

### Environment Variables
Configure the following in `.env` / Supabase Vault:
```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```
