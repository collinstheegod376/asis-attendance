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
- **Headers**: Optional `X-Attempt-Token` (reuses active uncompleted attempt without generating duplicate attempts)
- **Request Body**:
  ```json
  { "token": "raw-lecture-session-token" }
  ```
- **Response (200)**:
  ```json
  {
    "attempt_id": "uuid",
    "attempt_token": "random-256bit-hex",
    "session_id": "uuid",
    "course_id": "uuid",
    "expires_at": "2026-11-08T09:15:00Z",
    "step": "identity",
    "student_id": null
  }
  ```

### 2. `POST /functions/v1/lookup-matric`
- **Request Body**:
  ```json
  {
    "attempt_token": "attempt-token-hex",
    "matric_no": "ADUN/FS/COM/25/001"
  }
  ```
- **Response (200)**:
  ```json
  {
    "student_id": "uuid",
    "full_name": "Doe John Ada",
    "program": "Computer Science",
    "level": 400,
    "matric_no": "ADUN/FS/COM/25/001"
  }
  ```
- **Errors**:
  - `404 { "error": "NOT_ELIGIBLE" }` (Generic for unknown student and not enrolled, prevents enumeration)
  - `409 { "error": "STUDENT_LOCKED" }` (C2 attempt identity locking)
  - `409 { "error": "ALREADY_SIGNED" }`

### 3. `POST /functions/v1/device-check`
- **Request Body**:
  ```json
  {
    "attempt_token": "attempt-token-hex",
    "student_id": "uuid",
    "fingerprint": "client-canvas-webgl-fingerprint-raw",
    "local_device_id": "uuid-v4-string",
    "incognito_signal": false
  }
  ```
- **Response (200)**:
  ```json
  {
    "action": "OK",
    "reason": "BOUND",
    "reference_code": "BIND-200"
  }
  ```
  *Sets HTTP Header:* `Set-Cookie: adun_trusted_device=<signed-hmac-token>; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`

### 4. `POST /functions/v1/verify-location`
- **Request Body**:
  ```json
  {
    "attempt_token": "attempt-token-hex",
    "latitude": 6.3382,
    "longitude": 5.6258,
    "accuracy_m": 12.5
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "inside_boundary": true
  }
  ```

### 5. `POST /functions/v1/upload-selfie`
- **Request Body**:
  ```json
  {
    "attempt_token": "attempt-token-hex",
    "image_base64": "data:image/jpeg;base64,..."
  }
  ```
- **Response (200)**:
  ```json
  {
    "selfie_path": "attendance/<session_id>/<student_id>/<attempt_id>.jpg"
  }
  ```

### 6. `POST /functions/v1/submit-attendance`
- **Headers**: `Cookie: adun_trusted_device=...`
- **Request Body**:
  ```json
  {
    "attempt_token": "attempt-token-hex",
    "selfie_path": "attendance/<session_id>/<student_id>/<attempt_id>.jpg",
    "fingerprint_hash": "sha256-hex",
    "device_info": { "user_agent": "..." }
  }
  ```
- **Response (200)**:
  ```json
  {
    "receipt_id": "ADUN-20261109-A4F82B",
    "signed_at": "2026-11-09T08:05:22.000Z",
    "status": "present"
  }
  ```
- **Duplicate Response (409 ALREADY_SIGNED)**:
  ```json
  {
    "receipt_id": "ADUN-20261109-A4F82B",
    "signed_at": "2026-11-09T08:05:22.000Z",
    "status": "present"
  }
  ```

### 7. `POST /functions/v1/reset-device-binding`
- **Headers**: `Authorization: Bearer <lecturer-or-admin-jwt>`
- **Request Body**:
  ```json
  {
    "student_id": "uuid",
    "reason": "Student smartphone replaced"
  }
  ```
- **Response (200)**:
  ```json
  {
    "success": true,
    "reset_count": 1,
    "student_id": "uuid"
  }
  ```

### 8. `POST /functions/v1/import-roster`
- **Headers**: `Authorization: Bearer <lecturer-or-admin-jwt>`
- **Request Body**:
  ```json
  {
    "course_id": "uuid",
    "mode": "append",
    "rows": [
      { "matric_no": "ADUN/FS/COM/25/001" },
      { "matric_no": "ADUN/FS/COM/25/999" }
    ]
  }
  ```
- **Response (200)**:
  ```json
  {
    "accepted": ["ADUN/FS/COM/25/001"],
    "rejected": [
      {
        "row": 2,
        "matric": "ADUN/FS/COM/25/999",
        "reason": "Matriculation number not found in student master directory."
      }
    ]
  }
  ```

---

## 7. Unified Reference Code Taxonomy

All anti-proxy, device binding, and collision events use the canonical taxonomy defined in `_shared/reference-codes.ts`:

| Reference Code | Meaning | Action Returned | Trigger Condition |
| :--- | :--- | :--- | :--- |
| `BIND-200` | Bound Successfully / Valid | `OK` | First-time bind or matching hardware + cookie |
| `BIND-201` | Fingerprint Mismatch | `CONTACT_ADMIN` | Active student binding exists, but hardware fingerprint differs |
| `BIND-202` | Device Collision | `CONTACT_ADMIN` | Hardware fingerprint already bound to another active student |
| `BIND-203` | Same-Session Collision | `CONTACT_ADMIN` | Same hardware used to sign for 2+ students in the same lecture |
| `BIND-204` | Unrecognized Device | `CONTACT_ADMIN` | Known fingerprint, but trusted cookie is missing/invalid and incognito signal false |
| `BIND-205` | Incognito Mode Detected | `OPEN_NORMAL_BROWSER` | Known fingerprint with missing cookie and incognito signal, or incognito on initial bind |
| `BIND-206` | Administrative Reset | N/A | Recorded in `device_events` on admin/lecturer device reset |

---

## 8. Scheduled Cleanup & Data Retention (pg_cron)

Automated maintenance routines (`fn_cleanup_expired_data`) run according to institutional policies:
1. **Hourly**: Purge ephemeral `attendance_attempts` expired > 24 hours ago.
2. **Daily**: Purge `device_events` audit logs older than 365 days.
3. **Daily**: Clean storage selfies older than `settings.selfie_retention_days` (default 180 days).

Manual trigger:
```sql
SELECT public.fn_cleanup_expired_data();
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
