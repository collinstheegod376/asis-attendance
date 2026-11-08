# ADUN Attendance — Student Mobile PWA
**Admiralty University of Nigeria (ADUN) · Mobile Attendance Verification Gateway**

A mobile-first, installable Progressive Web Application (PWA) built with **Vite, React 19, TypeScript, Tailwind CSS v4, Lucide-react**, and full offline shell caching. Replicates the video UI pixel-for-pixel in a crisp **Navy Blue (`#1E40AF`) & White (`#FFFFFF`)** institutional theme.

---

## 🛡️ Key Specifications & Rules

1. **ZERO DEMO DATA**:
   - Strictly no mock or hardcoded student names, courses, or rosters.
   - All state is dynamically verified server-side through Supabase RPCs (`rpc_validate_session_token`, `rpc_lookup_matric`, `rpc_verify_location`, `rpc_submit_attendance`).
   - Clean loading states, error boundaries, and empty states.

2. **Route Architecture**:
   - `/`: Public landing page. ADUN insignia, prompt "Scan a lecture code to continue", in-app camera QR code scanner modal, and privacy notice link in footer. NO matric inputs, NO course lists, NO admin/lecturer links.
   - `/join/:token`: Validates token server-side (`no-referrer` policy). Redirects to `/expired`, `/invalid`, `/not-started`, or `/closed` on failures; creates `sessionStorage` attempt state and redirects to `/attend/identity` on success.
   - `/attend/identity`: Centered matric input with monospace font, live character counter, auto-normalization to uppercase and trimmed whitespace. Displays green **"STUDENT FOUND"** card with full name, programme, level, and manual edit option. Enforces soft device binding (`localStorage adun_device_binding`) using `SHA-256(matric + salt)`.
   - `/attend/location`: HTML5 Geolocation API with live accuracy readout (*"Location confirmed — accurate to ±14m"*), verifying coordinates against lecture hall/campus geofence via `rpc_verify_location`.
   - `/attend/selfie`: Stepper active on `(2) Selfie`. Circular camera viewfinder with animated dashed blue rotating border (`animate-spin-hud`). Live front camera feed, steady face detection with visual meter, 3-2-1 auto-countdown banner, retake button, and manual capture fallback. Uploads to private storage `attendance/<session_id>/<student_id>/<attempt_id>.jpg`.
   - `/attend/video`: Instructional video viewer with academic ethics brief and confirmation checkbox (*"I have watched and understand the lecture attendance instruction"*). Submits attendance atomically with idempotency key.
   - `/attend/confirmation`: Blue & White digital receipt with green checkmark, selfie thumbnail, student name, matric number, course code/title, Africa/Lagos timestamp, Present/Late badge, unique Receipt ID, print/download action, and confetti celebration effect.
   - **Status & Error Pages**:
     - `/expired`: "This attendance link has expired. Ask your lecturer for a new code."
     - `/invalid`: "Invalid or malformed attendance link."
     - `/not-started`: "This lecture session has not started yet."
     - `/closed`: "This session has been closed by the lecturer."
     - `/already-signed`: Displays student already signed with timestamp and course details.
     - `/not-enrolled`: "You are not enrolled for this course roster."
     - `/unsupported`: "Camera or Geolocation not supported / HTTPS required."
     - `/offline`: Network failure with retry button.
     - `/privacy`: Official ADUN Attendance Privacy Notice.

3. **PWA Shell Caching & Security**:
   - `manifest.webmanifest`: App name "ADUN Attendance", short_name "ADUN Attend", theme_color `#1E40AF`, background `#FFFFFF`, display `standalone`.
   - Service worker caches app shell only (`registerSW.js`, icons, CSS, JS bundles).
   - Dynamic token and attendance endpoints (`/join/*`, `/attend/*`, `/api/*`, Supabase) are strictly denylisted from caching and handled as `NetworkOnly`.

---

## 🚀 Running Locally

```bash
# Install dependencies
npm install

# Run dev server
npm run dev

# Run typecheck and production build
npm run build

# Preview production build
npm run preview
```
