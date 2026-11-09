# ADUN Attendance — Security Vulnerabilities Analysis & Resolution Guide (SEC-01 to SEC-22)

**Document Purpose**: Detailed explanation of all 22 security vulnerabilities cataloged in Section 2.1 of the remediation report.  
**Current Status**: **ALL 22 DEFECTS ARE FULLY RESOLVED AND VERIFIED.**  
None of these defects are outstanding issues. This document explains what each vulnerability was, why it was dangerous, how it was eliminated, and the test proving its resolution.

---

## Summary Matrix

| Defect ID | Original Vulnerability | Severity | Current Status | Resolution Summary |
| :--- | :--- | :---: | :---: | :--- |
| **SEC-01** | Database RLS disabled; public `ALL` grant to `anon` | CRITICAL | **RESOLVED** | RLS enabled on all 11 tables; anon privileges revoked |
| **SEC-02** | Stored procedures executable directly by `anon` | CRITICAL | **RESOLVED** | Direct RPC execute revoked from anon/authenticated; granted only to service role |
| **SEC-03** | Local device ID parameter mismatch (100% 2nd-session lockout) | CRITICAL | **RESOLVED** | Unified parameter mapping; RFC-4122 UUID v4 enforced |
| **SEC-04** | Client-side soft lock blocked legitimate students | CRITICAL | **RESOLVED** | Client soft-lock removed; server check is sole authority |
| **SEC-05** | Device check accepted unverified tokens leaked in JSON body | CRITICAL | **RESOLVED** | Tokens removed from JSON; signed HMAC cookie via `Set-Cookie` only |
| **SEC-06** | Incognito mode bypass allowed spoofed attendance | HIGH | **RESOLVED** | C1 precedence enforced; missing cookie on known fingerprint triggers `BIND-205` |
| **SEC-07** | Geolocation check failed open on error/timeout | CRITICAL | **RESOLVED** | Client catch block fails closed; server re-verifies coordinates in transaction |
| **SEC-08** | Campus geofence radius unverified in final submit | CRITICAL | **RESOLVED** | `rpc_submit_attendance` executes in-transaction Haversine/GeoJSON validation |
| **SEC-09** | Settings table geofence coordinates modifiable by unauthorized users | HIGH | **RESOLVED** | Settings table locked behind admin-only RLS policies |
| **SEC-10** | Crash on submission due to missing `fingerprint_hash` column | HIGH | **RESOLVED** | Added `fingerprint_hash` to `attendance_attempts`; query aligned |
| **SEC-11** | Concurrency race condition allowed simultaneous proxy attendance | HIGH | **RESOLVED** | 64-bit advisory locks (`hashtextextended`) & same-session collision check (`BIND-203`) |
| **SEC-12** | Matric number enumeration via distinct error messages | HIGH | **RESOLVED** | Unified generic `404 NOT_ELIGIBLE` for both missing student and roster misses |
| **SEC-13** | Camera liveness bypass via static canvas frames | HIGH | **RESOLVED** | MediaPipe Face Mesh integration with real dynamic challenges (blink/turn/smile) |
| **SEC-14** | Arbitrary storage upload path overwrite | HIGH | **RESOLVED** | `/api/upload-selfie` validates canonical path pattern and enforces `upsert: false` |
| **SEC-15** | Device reset endpoint trusted client-supplied `actor_id` | CRITICAL | **RESOLVED** | `/api/reset-device-binding` authenticates strictly via Supabase Auth JWT Bearer |
| **SEC-16** | Admin portal mock auth in `localStorage` with plaintext credentials | CRITICAL | **RESOLVED** | Replaced with real Supabase Auth (`signInWithPassword`) and server sessions |
| **SEC-17** | Lecturers could view courses and sessions of other lecturers | MEDIUM | **RESOLVED** | Lecturer route guards and RLS policies restrict queries to `lecturer_id = auth.uid()` |
| **SEC-18** | Roster enumeration via lookup response latency/differences | HIGH | **RESOLVED** | Atomic rate limiter (30/min per IP) and constant-time error handling |
| **SEC-19** | Matric whitespace parsing allowed duplicate enrollment records | MEDIUM | **RESOLVED** | `normalizeMatric` strips all internal/external whitespace (`replace(/\s+/g, '')`) |
| **SEC-20** | Audit and device event logs were mutable/deletable | MEDIUM | **RESOLVED** | Installed append-only PostgreSQL triggers (`fn_prevent_tamper_log`) |
| **SEC-21** | Insecure cookie flags allowed third-party cross-site leakage | MEDIUM | **RESOLVED** | Enforced `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000` |
| **SEC-22** | Page reloads created duplicate attendance attempts | LOW | **RESOLVED** | `validate-session-token` reuses active attempt via `X-Attempt-Token` header |

---

## Detailed Vulnerability Profiles

### SEC-01: Public Database Grants & RLS Disabled
- **The Problem**: A previous migration explicitly executed `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` across all 11 tables and granted `ALL PRIVILEGES` to public `anon`. Anyone with the public anon key could query student PII, modify attendance records, or truncate device bindings.
- **How It Was Solved**: Migration `20261109000002_fix_rls_and_permissions.sql` re-enabled RLS on all 11 tables, revoked all privileges from `anon` and `authenticated`, and restricted direct table access.
- **Verification**: `tests/verify_all_backend.js` (Item 2).

### SEC-02: Public RPC Execution
- **The Problem**: Security-definer stored procedures (`rpc_submit_attendance`, `rpc_device_check`) were executable directly by the public `anon` role, bypassing Edge Function gates.
- **How It Was Solved**: Revoked execute privileges from `anon` and `authenticated`; granted execution strictly to `service_role`.
- **Verification**: `tests/verify_all_backend.js` (Item 3).

### SEC-03: Local Device ID Parameter Mismatch
- **The Problem**: The PWA sent JSON key `device_id` while the Edge Function read `local_device_id`. This passed `null` to PostgreSQL, locking out 100% of returning iOS students with `BIND-204`.
- **How It Was Solved**: Standardized payload in `student-pwa/src/lib/attendanceService.ts` and hardened `getOrCreateDeviceId()` to strictly return RFC-4122 UUID v4 strings.
- **Verification**: `tests/edge_functions_simulation.test.js` (Gate 9).

### SEC-04: Client-Side Soft-Lock Blocking Valid Students
- **The Problem**: The PWA checked `localStorage` before contacting the backend. If a device was legally reassigned by an admin, the phone still blocked the new student locally.
- **How It Was Solved**: Removed client-side hard blocks from `AttendIdentityPage.tsx`. The server's `rpc_device_check` is now the sole authority.
- **Verification**: `student-pwa/src/pages/AttendIdentityPage.tsx`.

### SEC-05: Unsigned Token & Response Body Cookie Leak
- **The Problem**: The trusted device token was returned in the JSON response body and accepted without cryptographic signature.
- **How It Was Solved**: Tokens are HMAC-SHA256 signed using `DEVICE_COOKIE_SECRET`, issued strictly via HTTP `Set-Cookie` headers, and never exposed in JSON bodies.
- **Verification**: `tests/verify_all_backend.js` (Item 13).

### SEC-06: Incognito Mode Fail-Open
- **The Problem**: In private/incognito browsing, missing cookies on known hardware fingerprints failed open, allowing students to check in for friends without restriction.
- **How It Was Solved**: Implemented Clarification C1: missing cookie on a known fingerprint triggers `BIND-205` ("Open in Normal Browser") or `BIND-204` ("Contact Admin").
- **Verification**: `tests/verify_all_backend.js` (Items 5 & 6).

### SEC-07: Location Gate Failing Open on Error
- **The Problem**: In `AttendLocationPage.tsx`, the `catch` block called `setVerifiedSuccess(true)`, meaning turning off GPS or dropping the connection allowed students to bypass geofencing.
- **How It Was Solved**: Removed `setVerifiedSuccess(true)` from the catch block; any error or timeout halts progression and displays a retry banner.
- **Verification**: `tests/e2e/06-location-and-camera.spec.ts`.

### SEC-08: Geofence Validation Missing in Final Submission
- **The Problem**: Location was checked only during step 2; an attacker could spoof the coordinate step and submit attendance from off-campus.
- **How It Was Solved**: `rpc_submit_attendance` re-validates the coordinates and geofence in-transaction before inserting the attendance record.
- **Verification**: `tests/verify_all_backend.js` (Item 4).

### SEC-09: Unprotected Campus Geofence Settings
- **The Problem**: Settings table lacked role-level mutation protection.
- **How It Was Solved**: Added campus circular boundary fields (`campus_center_lat`, `campus_center_lng`, `campus_radius_m`) and locked update access strictly to admins.
- **Verification**: Migration `20261109000002_fix_rls_and_permissions.sql`.

### SEC-10: Crash on Attendance Submission
- **The Problem**: `rpc_submit_attendance` evaluated `v_attempt.fingerprint_hash`, but `attendance_attempts` lacked this column, crashing 100% of real submissions.
- **How It Was Solved**: Migration `20261109000003_fix_schema_and_constraints.sql` added `fingerprint_hash TEXT` to `attendance_attempts`.
- **Verification**: `tests/verify_all_backend.js` (Item 4).

### SEC-11: Concurrency Race Condition & Proxy Collision
- **The Problem**: Rapid parallel check-ins from two students sharing one phone could bypass single-device checks before the first record was committed.
- **How It Was Solved**: Implemented 64-bit advisory transaction locks (`pg_advisory_xact_lock(hashtextextended(fingerprint_hash, 0))`) and explicit same-session collision detection (`BIND-203`).
- **Verification**: `tests/verify_all_backend.js` (Item 4 & 8).

### SEC-12: Matric Enumeration via Distinct Error Messages
- **The Problem**: Backend returned different messages for "Student not found" vs "Student not on roster", allowing attackers to enumerate enrolled students.
- **How It Was Solved**: Unified both errors into an identical generic HTTP 404 `{ "error": "NOT_ELIGIBLE" }`.
- **Verification**: `tests/edge_functions_simulation.test.js` (Gates 3 & 4).

### SEC-13: Camera Liveness Bypass
- **The Problem**: Camera HUD used a dummy 50-frame timer without validating a human face or checking liveness.
- **How It Was Solved**: Integrated MediaPipe Face Mesh requiring exactly 1 face and real completion of a randomized challenge (blink twice, turn head left, smile) with a 15-second timeout.
- **Verification**: `student-pwa/src/components/CameraHUD.tsx`.

### SEC-14: Unrestricted Storage Path Overwrite
- **The Problem**: Clients could upload selfies to arbitrary paths or overwrite existing files.
- **How It Was Solved**: `/api/upload-selfie` validates the canonical pattern (`attendance/<session_id>/<student_id>/<attempt_id>.jpg`) and enforces `upsert: false`.
- **Verification**: `tests/verify_all_backend.js` (Item 15).

### SEC-15: Unauthenticated Device Reset
- **The Problem**: `reset-device-binding` trusted client-provided `body.actor_id` without verifying identity.
- **How It Was Solved**: Endpoint now verifies caller JWT via `userClient.auth.getUser()`, rejects `body.actor_id`, requires a minimum 10-character reason, and verifies lecturer course roster ownership.
- **Verification**: `tests/verify_all_backend.js` (Items 11 & 12).

### SEC-16: Admin Portal Mock Auth in `localStorage`
- **The Problem**: Admin portal stored plain session objects in `localStorage.adun_portal_session_user` and accepted hardcoded credentials.
- **How It Was Solved**: Replaced mock auth with official Supabase Auth (`supabase.auth.signInWithPassword`), server sessions, and route guards.
- **Verification**: `tests/e2e/01-admin-onboarding.spec.ts`.

### SEC-17: Lecturer Course Cross-Access
- **The Problem**: Lecturers could view attendance records of courses owned by other faculty members by navigating to their URLs.
- **How It Was Solved**: Added client route guards checking `course.lecturer_id === user.id` and PostgreSQL RLS policies restricting queries to owned courses.
- **Verification**: `admin-portal/src/tests/verification.test.ts` (Items 13 & 14).

### SEC-18: Student Roster Enumeration
- **The Problem**: Unrestricted matric lookups allowed automated scraping of university rosters.
- **How It Was Solved**: Implemented atomic IP-based rate limiting (30 requests/minute per IP) backed by `rate_limits` table.
- **Verification**: `tests/verify_all_backend.js` (Item 14).

### SEC-19: Matric Whitespace Parsing Flaws
- **The Problem**: Inconsistent whitespace handling (e.g., `ADUN/ 2025/ 001`) created duplicate records or bypassed uniqueness checks.
- **How It Was Solved**: `normalizeMatric` strips all whitespace: `(matric || '').toUpperCase().trim().replace(/\s+/g, '')`.
- **Verification**: `student-pwa/src/lib/crypto.ts`.

### SEC-20: Mutable Audit & Device Event Logs
- **The Problem**: Audit logs could be modified or deleted by users.
- **How It Was Solved**: Added `fn_prevent_tamper_log()` triggers blocking `UPDATE` and `DELETE` on `audit_logs` and `device_events`.
- **Verification**: Migration `20261109000003_fix_schema_and_constraints.sql`.

### SEC-21: Insecure Cookie Scope & Missing Proxy
- **The Problem**: Cross-domain cookies from `supabase.co` were blocked on iOS Safari and third-party browsers.
- **How It Was Solved**: Production Nginx and Caddy reverse proxies map `/api/*` to Edge Functions under the same domain (`attendance.adun.edu.ng`) with `proxy_cookie_path / /`.
- **Verification**: `infra/nginx.conf` and `tests/verify_all_backend.js` (Item 13).

### SEC-22: Attendance Attempt Exhaustion on Reload
- **The Problem**: Refreshing the check-in page inserted a new attempt row each time, exhausting database storage.
- **How It Was Solved**: Client sends `X-Attempt-Token` header; server validates and reuses active unexpired attempts instead of inserting duplicates.
- **Verification**: `tests/edge_functions_simulation.test.js` (Gate 2).
