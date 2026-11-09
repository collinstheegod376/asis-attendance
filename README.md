# ADUN Attendance System

An institutional attendance management system for Admiralty University of Nigeria (ADUN), featuring a fraud-resistant Student Mobile PWA, a Lecturer Classroom Projector Mode, and an Administrative Governance Portal, powered by Supabase.

Designed and styled in **Navy Blue (`#1E40AF`) & Crisp White (`#FFFFFF`)**.

---

## 🏛️ Ecosystem Overview

```
                      ┌────────────────────────────────────────┐
                      │    Lecturer Classroom Projector Mode   │
                      │  - Fullscreen display in lecture hall  │
                      │  - High-contrast dynamic Session QR    │
                      │  - Real-time attendee counter & feed   │
                      └──────────────────┬─────────────────────┘
                                         │ Scanned by student
                                         ▼
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        Student Mobile PWA       │           │       Admin & Faculty Portal    │
│  - Public QR landing / scanner  │           │  - Seed admin (forced pw change)│
│  - Step 1: Matric lookup + lock │           │  - Lecturer provisioning        │
│  - Step 2: Live GPS accuracy    │           │  - Authoritative roster import  │
│  - Step 3: Face HUD auto-snap   │           │  - Interactive calendar & selfie│
│  - Step 4: Instructional video  │           │  - 2-Sheet Excel export         │
│  - Step 5: Digital receipt (WAT)│           │  - Device binding resets        │
└────────────────┬────────────────┘           └────────────────┬────────────────┘
                 │                                             │
                 └──────────────────────┬──────────────────────┘
                                        ▼
                      ┌────────────────────────────────────────┐
                      │      Nginx / Caddy Reverse Proxy       │
                      │  - attendance.adun.edu.ng (PWA)        │
                      │  - admin.attendance.adun.edu.ng (Admin)│
                      │  - /api/* -> Supabase Edge Functions   │
                      │  - First-Party HttpOnly Cookie Proxy   │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │         Supabase PostgreSQL & Edge     │
                      │  - RLS policies & transactional RPCs   │
                      │  - 64-bit advisory locking             │
                      │  - Private storage bucket for selfies  │
                      │  - Zero demo data policy               │
                      └────────────────────────────────────────┘
```

---

## 📁 Repository Structure

- [`student-pwa/`](./student-pwa): Mobile-first progressive web app for students. Check-in flow with circular camera HUD, GPS verification, hardware device binding (`adun_trusted_device` cookie), and digital receipts.
- [`admin-portal/`](./admin-portal): Desktop/tablet dashboard for Faculty Lecturers and Administrators. Includes Classroom Projector Mode, interactive attendance calendar with signed selfie viewing, 2-sheet Excel export, and governance controls.
- [`supabase/`](./supabase): Database schema, ordered migration SQL files, Deno Edge Functions, and RLS policies.
- [`infra/`](./infra): Production Nginx and Caddy reverse proxy configurations, local TLS parity (`mkcert`), and Dockerfiles.
- [`tests/`](./tests): Backend verification runner, Edge Functions simulation, Playwright E2E suites, and load test scripts.

---

## 🚀 Production Deployment Runbook

### 1. Environment Variables Configuration

#### Supabase Edge Functions Secrets
Set these secrets via the Supabase CLI before deploying Edge Functions:
```bash
supabase secrets set \
  DEVICE_COOKIE_SECRET="<generate-random-high-entropy-32-char-secret>" \
  FINGERPRINT_SALT="<generate-random-high-entropy-32-char-salt>" \
  APP_URL="https://attendance.adun.edu.ng" \
  STUDENT_PWA_URL="https://attendance.adun.edu.ng" \
  SUPABASE_URL="https://<project-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

#### Student Mobile PWA Build Environment (`student-pwa/.env`)
```bash
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon-key>"
```

#### Admin & Lecturer Portal Build Environment (`admin-portal/.env`)
```bash
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon-key>"
```

> [!CAUTION]
> NEVER expose `SUPABASE_SERVICE_ROLE_KEY` in any frontend `.env` file or client bundle.

---

### 2. Database Migration Execution Order

Apply migrations strictly in chronological sequence:
```bash
# 1. Base schema & extensions
supabase db execute --file supabase/migrations/20261108000000_adun_attendance_schema.sql

# 2. Permissions & seed structure
supabase db execute --file supabase/migrations/20261109000000_supabase_full_seed_and_permissions.sql

# 3. Purge test fixtures, retain single clean seed admin
supabase db execute --file supabase/migrations/20261109000001_purge_to_clean_seed_admin_only.sql

# 4. RLS hardening & anon revocation
supabase db execute --file supabase/migrations/20261109000002_fix_rls_and_permissions.sql

# 5. Schema constraints & performance indexes
supabase db execute --file supabase/migrations/20261109000003_fix_schema_and_constraints.sql

# 6. Atomic rate limiting table & functions
supabase db execute --file supabase/migrations/20261109000004_rate_limit_table.sql

# 7. 64-bit advisory locked RPCs & Lagos timezone receipts
supabase db execute --file supabase/migrations/20261109000005_rewrite_rpc_functions.sql
```

---

### 3. Deploy Supabase Edge Functions

Deploy all 8 verified Edge Functions:
```bash
supabase functions deploy device-check --no-verify-jwt
supabase functions deploy submit-attendance --no-verify-jwt
supabase functions deploy lookup-matric --no-verify-jwt
supabase functions deploy validate-session-token --no-verify-jwt
supabase functions deploy verify-location --no-verify-jwt
supabase functions deploy upload-selfie --no-verify-jwt
supabase functions deploy reset-device-binding
supabase functions deploy import-roster
```

---

### 4. Build Frontends for Production

Run verified builds with 0 sourcemap output and 0 service-role key leaks:
```bash
# Build Student PWA
cd student-pwa
npm ci
npm run build # outputs to dist/

# Build Admin Portal
cd ../admin-portal
npm ci
npm run build # outputs to dist/
```

---

### 5. Deploy Reverse Proxy (Nginx / Caddy)

Deploy using the provided configurations in `infra/`:
- **Nginx**: Copy `infra/nginx.conf` to `/etc/nginx/nginx.conf`.
- **Caddy**: Copy `infra/Caddyfile` to `/etc/caddy/Caddyfile`.
- **Docker**:
  ```bash
  docker-compose up -d --build
  ```

#### Reverse Proxy Routing Rules:
- `attendance.adun.edu.ng` -> Serves `student-pwa/dist/`
- `admin.attendance.adun.edu.ng` -> Serves `admin-portal/dist/`
- `/api/*` -> Reverse proxies to `https://<project-ref>.supabase.co/functions/v1/*` preserving `Set-Cookie` and `Cookie` headers via `proxy_cookie_path / /`.

---

### 6. Post-Deployment Verification & Smoke Test Checklist

- [ ] **HTTPS & Security Headers**: Confirm HSTS, X-Content-Type-Options, X-Frame-Options, and CSP headers are active.
- [ ] **Zero Secrets in Dist**: Run `node scripts/secret-scan.cjs` and verify 0 findings.
- [ ] **First-Party Cookies**: From an iOS Safari device, verify `adun_trusted_device` cookie is stored with `SameSite=Lax` and `HttpOnly`.
- [ ] **Seed Admin Login**: Login to `https://admin.attendance.adun.edu.ng/login` as `admin@adun.edu.ng` / `Admin123!`. Confirm forced password change prompt appears immediately.
- [ ] **Lecturer Provisioning**: Create a lecturer and assign a course.
- [ ] **Roster Validation**: Upload a roster CSV with 1 unknown matric. Confirm unknown student is rejected with row number, and known students are enrolled.
- [ ] **Live Session & Dynamic QR**: Start a session and present the dynamic QR code in projector mode.
- [ ] **Student Mobile Check-in**: Open the session link on a mobile device:
  - [ ] Geolocation check passes inside campus geofence.
  - [ ] Camera HUD captures photo and immediately terminates the `MediaStream` track.
  - [ ] Attendance confirmed with **`Africa/Lagos` (WAT)** timestamped receipt.
  - [ ] Lecturer dashboard updates real-time with attendee record.
- [ ] **Concurrency & Load**: Run `node tests/load/run_load_test.cjs` to confirm 120 concurrent students complete with p95 < 2s and 0% error rate.
