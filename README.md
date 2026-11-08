# ADUN Attendance System

An institutional attendance management system for Admiralty University of Nigeria (ADUN), featuring a fraud-resistant Student Mobile PWA, a Lecturer Classroom Projector Mode, and an Administrative Governance Portal, powered by Supabase.

Designed and styled in **Navy Blue (`#1E40AF`) & Crisp White (`#FFFFFF`)**.

---

## 🏛️ Ecosystem Overview

```
                      ┌────────────────────────────────────────┐
                      │    Lecturer Classroom Projector Mode   │
                      │  - Fullscreen display in lecture hall  │
                      │  - High-contrast static Session QR     │
                      │  - Real-time attendee counter & feed   │
                      └──────────────────┬─────────────────────┘
                                         │ Scanned by student
                                         ▼
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│        Student Mobile PWA       │           │       Admin & Faculty Portal    │
│  - Public QR landing / scanner  │           │  - Seed admin (forced pw change)│
│  - Step 1: Matric lookup + lock │           │  - Lecturer provisioning (9 cap)│
│  - Step 2: Live GPS accuracy    │           │  - Authoritative roster import  │
│  - Step 3: Face HUD auto-snap   │           │  - Interactive calendar & selfie│
│  - Step 4: Instructional video  │           │  - 2-Sheet Excel export         │
│  - Step 5: Digital receipt (WAT)│           │  - Device binding resets        │
└────────────────┬────────────────┘           └────────────────┬────────────────┘
                 │                                             │
                 └──────────────────────┬──────────────────────┘
                                        ▼
                      ┌────────────────────────────────────────┐
                      │         Supabase PostgreSQL & Edge     │
                      │  - RLS policies & transactional RPCs   │
                      │  - Private storage bucket for selfies  │
                      │  - Zero demo data policy               │
                      └────────────────────────────────────────┘
```

---

## 📁 Repository Structure

- [`student-pwa/`](./student-pwa): Mobile-first progressive web app for students. Replicates the reference check-in flow with circular camera HUD, GPS verification, localStorage soft device lock (`adun_device_binding`), and digital receipts.
- [`admin-portal/`](./admin-portal): Desktop/tablet dashboard for Faculty Lecturers and Administrators. Includes the Classroom Projector Mode, interactive attendance calendar with signed selfie viewing, 2-sheet Excel export, and governance controls.
- [`supabase/`](./supabase): Complete database schema, migration SQL (`20261108000000_adun_attendance_schema.sql`), Deno Edge Functions, and TypeScript service layer.

---

## 🚀 Getting Started

### 1. Database Setup (Supabase)
Apply the migration to your Supabase project:
```bash
# Using Supabase CLI
supabase db push
# Or copy the contents of supabase/migrations/20261108000000_adun_attendance_schema.sql into your Supabase SQL Editor
```

**Seed Administrator Credentials**:
- **Username**: `admin`
- **Password**: `admin`
- *(Enforces a mandatory password change on first login)*

### 2. Run the Student Mobile PWA
```bash
cd student-pwa
npm install
npm run dev
```
Runs at `http://localhost:5173`.

### 3. Run the Admin & Lecturer Portal
```bash
cd admin-portal
npm install
npm run dev
```
Runs at `http://localhost:5174` (or next available port).

---

## 🔒 Anti-Proxy & Security Architecture

1. **Roster Gating**: Student must exist in the Master Student Directory (`students_master`) and be enrolled on the lecturer's course roster (`course_roster`).
2. **Soft Device Lock**: After the first successful check-in on a device, the student's matric hash is bound in `localStorage`. Entering a different matric number on the same device is blocked until an administrator or lecturer issues a reset.
3. **Campus Geofencing**: Validates GPS accuracy against institutional thresholds (default $\le 50\text{m}$) and verifies coordinates against the university geofence.
4. **Biometric Face HUD**: Uses a front-camera circular viewfinder with animated blue HUD and auto-capture countdown. Photos are stored in a private Supabase Storage bucket (`attendance/<session_id>/<student_id>/<attempt_id>.jpg`) and viewable only via short-lived signed URLs.
5. **Timezone Authority**: All records, timers, grace periods, and late penalties are evaluated server-side in **`Africa/Lagos` (WAT)**.
