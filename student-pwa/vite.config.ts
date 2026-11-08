import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE_PATH = path.resolve(__dirname, '..', '.local-sync-db.json')

function readSyncDb(): Record<string, any> {
  try {
    if (!fs.existsSync(DB_FILE_PATH)) return {}
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeSyncDb(data: Record<string, any>): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to write .local-sync-db.json:', err)
  }
}

function normalizeMatric(m: string): string {
  return String(m || '').trim().toUpperCase().replace(/\s+/g, '')
}

function sha256Hex(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex')
}

function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=')
    if (idx > -1) {
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      out[k] = v
    }
  })
  return out
}

function adunStudentRpcPlugin(): Plugin {
  return {
    name: 'adun-student-rpc-plugin',
    configureServer(server) {
      server.middlewares.use('/api/local-rpc', (req, res) => {
        res.setHeader('Content-Type', 'application/json')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }))
          return
        }

        let body = ''
        req.on('data', (chunk) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const payload = body ? JSON.parse(body) : {}
            const fnName: string = payload.fn || ''
            const args: Record<string, any> = payload.args || {}
            const db = readSyncDb()

            const sessions: any[] = db.adun_sessions || []
            const courses: any[] = db.adun_courses || []
            const studentsMaster: any[] = db.adun_students_master || []
            const courseRoster: any[] = db.adun_course_roster || []
            const attendanceRecords: any[] = db.adun_attendance_records || []
            const deviceBindings: any[] = db.adun_device_bindings || []
            const deviceEvents: any[] = db.adun_device_events || []
            const auditLogs: any[] = db.adun_audit_logs || []
            const attempts: any[] = db.adun_attempts || []
            const settings: any = db.adun_settings || {}

            const logDeviceEvt = (evt: Record<string, any>) => {
              deviceEvents.unshift({
                id: 'devevt_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                created_at: new Date().toISOString(),
                ...evt,
              })
              db.adun_device_events = deviceEvents
            }

            const logAuditEvt = (evt: Record<string, any>) => {
              auditLogs.unshift({
                id: 'aud_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                created_at: new Date().toISOString(),
                ...evt,
              })
              db.adun_audit_logs = auditLogs
            }

            // 1. Validate Session Token
            if (fnName === 'rpc_validate_session_token') {
              const rawToken = String(args.p_raw_token || '').trim()
              if (!rawToken) {
                res.end(JSON.stringify({ success: false, error: 'INVALID_TOKEN' }))
                return
              }
              const tokenHash = sha256Hex(rawToken)
              const session = sessions.find(
                (s) => s.raw_token === rawToken || s.token_hash === tokenHash || s.id === rawToken
              )

              if (!session) {
                res.end(JSON.stringify({ success: false, error: 'INVALID_TOKEN' }))
                return
              }

              const course = courses.find((c) => c.id === session.course_id)
              if (course && course.status === 'archived') {
                res.end(JSON.stringify({ success: false, error: 'COURSE_ARCHIVED' }))
                return
              }

              if (session.status === 'closed' || session.status === 'revoked') {
                res.end(JSON.stringify({ success: false, error: 'SESSION_CLOSED' }))
                return
              }

              const now = Date.now()
              const startsAt = new Date(session.starts_at).getTime()
              const expiresAt = new Date(session.expires_at).getTime()

              if (now < startsAt - 60000) {
                res.end(JSON.stringify({ success: false, error: 'SESSION_NOT_STARTED' }))
                return
              }

              if (now > expiresAt || session.status === 'expired') {
                res.end(JSON.stringify({ success: false, error: 'SESSION_EXPIRED' }))
                return
              }

              const attemptId = 'att_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex')
              const attemptToken = crypto.randomBytes(24).toString('hex')

              attempts.unshift({
                id: attemptId,
                attempt_token: attemptToken,
                session_id: session.id,
                step: 'identity',
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              })
              db.adun_attempts = attempts
              writeSyncDb(db)

              res.end(
                JSON.stringify({
                  success: true,
                  attempt_id: attemptId,
                  attempt_token: attemptToken,
                  session: {
                    id: session.id,
                    course_id: session.course_id,
                    course_code: session.course_code || course?.code || 'ADUN',
                    course_title: session.course_title || course?.title || session.title,
                    title: session.title,
                    starts_at: session.starts_at,
                    expires_at: session.expires_at,
                    grace_minutes: session.grace_minutes ?? settings.grace_minutes ?? 10,
                    location_mode: settings.location_mode || 'evidence_only',
                    location_accuracy_threshold_m: settings.location_accuracy_threshold_m || 50,
                  },
                })
              )
              return
            }

            // 2. Lookup Matric
            if (fnName === 'rpc_lookup_matric') {
              const attempt = attempts.find((a) => a.id === args.p_attempt_id)
              if (!attempt) {
                res.end(JSON.stringify({ success: false, error: 'ATTEMPT_EXPIRED' }))
                return
              }
              const session = sessions.find((s) => s.id === attempt.session_id)
              if (!session || session.status === 'closed' || Date.now() > new Date(session.expires_at).getTime()) {
                res.end(JSON.stringify({ success: false, error: 'SESSION_EXPIRED' }))
                return
              }

              const cleanMatric = normalizeMatric(args.p_raw_matric)
              const student = studentsMaster.find((s) => normalizeMatric(s.matric_no) === cleanMatric)
              if (!student) {
                res.end(
                  JSON.stringify({
                    success: false,
                    error: 'STUDENT_NOT_FOUND',
                    message: 'Matric number not found in Master Student Directory.',
                  })
                )
                return
              }

              const onRoster = courseRoster.some(
                (r) =>
                  r.course_id === session.course_id &&
                  (r.student_id === student.id || normalizeMatric(r.matric_no) === cleanMatric)
              )
              if (!onRoster) {
                res.end(
                  JSON.stringify({
                    success: false,
                    error: 'NOT_ON_ROSTER',
                    message: 'You are not enrolled on the roster for this course.',
                  })
                )
                return
              }

              const alreadySigned = attendanceRecords.some(
                (r) =>
                  r.session_id === session.id &&
                  (r.student_id === student.id || normalizeMatric(r.matric_no) === cleanMatric)
              )
              if (alreadySigned) {
                res.end(
                  JSON.stringify({
                    success: false,
                    error: 'ALREADY_SIGNED',
                    student: {
                      id: student.id,
                      matric_no: student.matric_no,
                      surname: student.surname,
                      first_name: student.first_name,
                      middle_name: student.middle_name || '',
                      program: student.program,
                      level: student.level,
                    },
                  })
                )
                return
              }

              attempt.student_id = student.id
              attempt.matric_no = student.matric_no
              attempt.device_id = args.p_device_id
              writeSyncDb(db)

              res.end(
                JSON.stringify({
                  success: true,
                  student: {
                    id: student.id,
                    matric_no: student.matric_no,
                    surname: student.surname,
                    first_name: student.first_name,
                    middle_name: student.middle_name || '',
                    program: student.program,
                    level: student.level,
                  },
                })
              )
              return
            }

            // 3. Option 2 Strict Device Check
            if (fnName === 'rpc_device_check') {
              const studentId = String(args.p_student_id || '')
              const fpHash = String(args.p_fingerprint_hash || '')
              const localDeviceId = args.p_local_device_id ? String(args.p_local_device_id) : null
              const incognitoSignal = Boolean(args.p_incognito_signal)
              const ua = String(args.p_user_agent || req.headers['user-agent'] || '')

              const cookies = parseCookies(req.headers.cookie)
              const cookieToken = cookies['adun_trusted_device'] || null
              const cookieTokenHash = cookieToken ? sha256Hex(cookieToken) : null

              const student = studentsMaster.find((s) => s.id === studentId)
              const matricNo = student?.matric_no || studentId
              const studentName = student ? `${student.surname} ${student.first_name}` : 'Student'

              if (incognitoSignal) {
                logDeviceEvt({
                  student_id: studentId,
                  matric_no: matricNo,
                  event_type: 'cookie_missing',
                  reference_code: 'BIND-205',
                  device_id: localDeviceId || fpHash.slice(0, 12),
                  ip_address: '127.0.0.1',
                  user_agent: ua,
                  reason: 'Incognito / private browsing detected',
                })
                writeSyncDb(db)
                res.end(
                  JSON.stringify({
                    success: false,
                    action: 'OPEN_NORMAL_BROWSER',
                    reference_code: 'BIND-205',
                    reason: 'Attendance is not allowed in Incognito. Open your normal browser.',
                  })
                )
                return
              }

              // Check if fingerprint is bound to a DIFFERENT student (active & not shared)
              const conflictBinding = deviceBindings.find(
                (b) =>
                  b.status === 'active' &&
                  !b.is_shared &&
                  (b.device_fingerprint_hash === fpHash || b.fingerprint_hash === fpHash) &&
                  b.student_id !== studentId
              )

              if (conflictBinding) {
                logDeviceEvt({
                  student_id: studentId,
                  matric_no: matricNo,
                  event_type: 'proxy_detected',
                  reference_code: 'BIND-202',
                  device_id: localDeviceId || fpHash.slice(0, 12),
                  ip_address: '127.0.0.1',
                  user_agent: ua,
                  reason: 'Device fingerprint already bound to another active student',
                  metadata: { conflicting_binding_id: conflictBinding.id, fingerprint_hash: fpHash },
                })
                logAuditEvt({
                  actor_id: studentId,
                  actor_name: studentName,
                  actor_role: 'system',
                  action: 'PROXY_DEVICE_BLOCKED',
                  entity: 'device_bindings',
                  entity_id: conflictBinding.id,
                  reference_code: 'BIND-202',
                  metadata: { matric_no: matricNo, reason: 'Device already registered to another student' },
                })
                writeSyncDb(db)
                res.end(
                  JSON.stringify({
                    success: false,
                    action: 'DEVICE_IN_USE',
                    reference_code: 'BIND-202',
                    reason: 'This device is registered to another student. Contact the admin if this is an error.',
                  })
                )
                return
              }

              const activeBinding = deviceBindings.find(
                (b) => b.student_id === studentId && b.status === 'active'
              )

              const revokedBinding = deviceBindings.find(
                (b) => b.student_id === studentId && b.status === 'revoked'
              )

              if (!activeBinding && revokedBinding) {
                res.end(
                  JSON.stringify({
                    success: false,
                    action: 'CONTACT_ADMIN',
                    reference_code: 'BIND-209',
                    reason: 'Your device binding was revoked by an administrator. Contact admin.',
                  })
                )
                return
              }

              // First ever sign-in (or after admin reset)
              if (!activeBinding) {
                const newCookieToken = crypto.randomBytes(32).toString('hex')
                const newCookieHash = sha256Hex(newCookieToken)
                const nowIso = new Date().toISOString()

                const newBinding = {
                  id: 'bind_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                  device_id: localDeviceId || fpHash.slice(0, 16),
                  device_fingerprint_hash: fpHash,
                  fingerprint_hash: fpHash,
                  trusted_cookie_hash: newCookieHash,
                  student_id: studentId,
                  matric_no: matricNo,
                  student_name: studentName,
                  matric_hash: sha256Hex(matricNo),
                  user_agent: ua,
                  ip_address: '127.0.0.1',
                  first_bound_at: nowIso,
                  last_seen_at: nowIso,
                  status: 'active',
                  is_shared: false,
                }
                deviceBindings.unshift(newBinding)
                db.adun_device_bindings = deviceBindings

                logDeviceEvt({
                  student_id: studentId,
                  matric_no: matricNo,
                  event_type: 'bind',
                  reference_code: 'BIND-201',
                  device_id: newBinding.device_id,
                  ip_address: '127.0.0.1',
                  user_agent: ua,
                  reason: 'Initial hardware fingerprint & HttpOnly cookie bound',
                })

                writeSyncDb(db)
                res.setHeader(
                  'Set-Cookie',
                  `adun_trusted_device=${newCookieToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`
                )
                res.end(
                  JSON.stringify({
                    success: true,
                    action: 'ALLOW',
                    reference_code: 'BIND-201',
                  })
                )
                return
              }

              // Subsequent sign-in: check fingerprint match
              const boundFp = activeBinding.device_fingerprint_hash || activeBinding.fingerprint_hash
              if (boundFp && boundFp !== fpHash) {
                logDeviceEvt({
                  student_id: studentId,
                  matric_no: matricNo,
                  event_type: 'mismatch',
                  reference_code: 'BIND-201',
                  device_id: localDeviceId || fpHash.slice(0, 12),
                  ip_address: '127.0.0.1',
                  user_agent: ua,
                  reason: 'New physical device fingerprint detected',
                })
                writeSyncDb(db)
                res.end(
                  JSON.stringify({
                    success: false,
                    action: 'NEW_DEVICE',
                    reference_code: 'BIND-201',
                    reason: 'New device detected. Contact the admin to reset your device, then try again.',
                  })
                )
                return
              }

              // Check continuity (cookie or localDeviceId)
              if (!cookieTokenHash && (!localDeviceId || activeBinding.device_id !== localDeviceId)) {
                logDeviceEvt({
                  student_id: studentId,
                  matric_no: matricNo,
                  event_type: 'cookie_missing',
                  reference_code: 'BIND-204',
                  device_id: localDeviceId || fpHash.slice(0, 12),
                  ip_address: '127.0.0.1',
                  user_agent: ua,
                  reason: 'Trusted cookie and local device continuity missing',
                })
                writeSyncDb(db)
                res.end(
                  JSON.stringify({
                    success: false,
                    action: 'CONTACT_ADMIN',
                    reference_code: 'BIND-204',
                    reason: 'This device is not fully recognised. Contact the admin to reset your device, then try again.',
                  })
                )
                return
              }

              // Valid match! Update last_seen_at
              activeBinding.last_seen_at = new Date().toISOString()
              logDeviceEvt({
                student_id: studentId,
                matric_no: matricNo,
                event_type: 'match',
                reference_code: 'BIND-200',
                device_id: activeBinding.device_id,
                ip_address: '127.0.0.1',
                user_agent: ua,
                reason: 'Verified bound device',
              })
              writeSyncDb(db)

              res.end(
                JSON.stringify({
                  success: true,
                  action: 'ALLOW',
                  reference_code: 'BIND-200',
                })
              )
              return
            }

            // 4. Verify Location
            if (fnName === 'rpc_verify_location') {
              const attempt = attempts.find((a) => a.id === args.p_attempt_id)
              const lat = Number(args.p_latitude)
              const lng = Number(args.p_longitude)
              const acc = Number(args.p_accuracy_m)

              const centerLat = Number(settings.campus_center_lat ?? 6.2235)
              const centerLng = Number(settings.campus_center_lng ?? 6.618)
              const radiusM = Number(settings.campus_radius_m ?? 1500)
              const maxAcc = Number(settings.location_accuracy_threshold_m ?? 50)
              const mode = settings.location_mode || 'evidence_only'

              const dist = haversineDistanceM(lat, lng, centerLat, centerLng)
              const insideBoundary = dist <= radiusM

              if (mode === 'enforce') {
                if (acc > maxAcc) {
                  res.end(JSON.stringify({ success: false, error: 'LOW_ACCURACY', accuracy_m: acc }))
                  return
                }
                if (!insideBoundary) {
                  res.end(JSON.stringify({ success: false, error: 'OUTSIDE_CAMPUS_BOUNDARY', distance_m: Math.round(dist) }))
                  return
                }
              }

              if (attempt) {
                attempt.latitude = lat
                attempt.longitude = lng
                attempt.accuracy_m = acc
                writeSyncDb(db)
              }

              res.end(
                JSON.stringify({
                  success: true,
                  inside_boundary: insideBoundary,
                  distance_m: Math.round(dist),
                  mode,
                })
              )
              return
            }

            // 5. Submit Attendance
            if (fnName === 'rpc_submit_attendance') {
              const attempt = attempts.find((a) => a.id === args.p_attempt_id)
              if (!attempt) {
                res.end(JSON.stringify({ success: false, error: 'ATTEMPT_EXPIRED' }))
                return
              }
              const session = sessions.find((s) => s.id === attempt.session_id)
              if (!session || session.status === 'closed' || Date.now() > new Date(session.expires_at).getTime()) {
                res.end(JSON.stringify({ success: false, error: 'SESSION_EXPIRED' }))
                return
              }
              const student = studentsMaster.find((s) => s.id === attempt.student_id)
              if (!student) {
                res.end(JSON.stringify({ success: false, error: 'STUDENT_NOT_FOUND' }))
                return
              }

              // Check duplicate
              const duplicate = attendanceRecords.find(
                (r) => r.session_id === session.id && r.student_id === student.id
              )
              if (duplicate) {
                res.end(JSON.stringify({ success: false, error: 'ALREADY_SIGNED' }))
                return
              }

              const deviceInfo = args.p_device_info || {}
              const fpHash = String(deviceInfo.fingerprint_hash || '')

              // Belt-and-braces: Same-session multi-student check (Section 10)
              if (fpHash) {
                const sameSessionOtherStudent = attendanceRecords.find(
                  (r) =>
                    r.session_id === session.id &&
                    r.fingerprint_hash === fpHash &&
                    r.student_id !== student.id
                )
                if (sameSessionOtherStudent) {
                  logDeviceEvt({
                    student_id: student.id,
                    matric_no: student.matric_no,
                    event_type: 'proxy_detected',
                    reference_code: 'BIND-203',
                    device_id: deviceInfo.device_id || fpHash.slice(0, 12),
                    ip_address: '127.0.0.1',
                    user_agent: deviceInfo.userAgent || '',
                    reason: 'Same physical device used for multiple students in the same session',
                  })
                  logAuditEvt({
                    actor_id: student.id,
                    actor_name: `${student.surname} ${student.first_name}`,
                    actor_role: 'system',
                    action: 'SAME_SESSION_COLLISION_BLOCKED',
                    entity: 'attendance_records',
                    entity_id: session.id,
                    reference_code: 'BIND-203',
                    metadata: { matric_no: student.matric_no, fingerprint_hash: fpHash },
                  })
                  writeSyncDb(db)
                  res.end(
                    JSON.stringify({
                      success: false,
                      error: 'SHARED_DEVICE',
                      reference_code: 'BIND-203',
                      reason: 'This device has already been used for another student in this session. Contact the admin.',
                    })
                  )
                  return
                }
              }

              const signedAt = new Date()
              const startsAtMs = new Date(session.starts_at).getTime()
              const graceMs = (session.grace_minutes ?? settings.grace_minutes ?? 10) * 60 * 1000
              const status: 'present' | 'late' =
                signedAt.getTime() - startsAtMs <= graceMs ? 'present' : 'late'

              const datePart = signedAt.toISOString().slice(0, 10).replace(/-/g, '')
              const randPart = crypto.randomBytes(3).toString('hex').toUpperCase()
              const receiptId = `ADUN-${datePart}-${randPart}`

              const activeBinding = deviceBindings.find(
                (b) => b.student_id === student.id && b.status === 'active'
              )
              const proxyRisk = activeBinding?.is_shared ? 'medium' : 'low'
              const studentFullName = `${student.surname} ${student.first_name} ${student.middle_name || ''}`.trim()

              const newRecord = {
                id: 'attrec_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex'),
                session_id: session.id,
                course_id: session.course_id,
                student_id: student.id,
                matric_no: student.matric_no,
                student_name: studentFullName,
                program: student.program,
                level: student.level,
                signed_at: signedAt.toISOString(),
                status,
                latitude: attempt.latitude ?? null,
                longitude: attempt.longitude ?? null,
                accuracy_m: attempt.accuracy_m ?? null,
                selfie_path: args.p_selfie_path || '',
                selfie_url: deviceInfo.selfie_data_url || null,
                verification_status: 'passed',
                device_id: deviceInfo.device_id || attempt.device_id,
                fingerprint_hash: fpHash,
                fingerprint_snapshot_ref: fpHash ? `DEV-SNAP-${fpHash.slice(0, 10).toUpperCase()}` : undefined,
                proxy_risk: proxyRisk,
                receipt_id: receiptId,
              }

              attendanceRecords.unshift(newRecord)
              db.adun_attendance_records = attendanceRecords
              writeSyncDb(db)

              res.end(
                JSON.stringify({
                  success: true,
                  receipt_id: receiptId,
                  status,
                  signed_at: signedAt.toISOString(),
                  course_code: session.course_code,
                  course_title: session.course_title,
                  student_name: `${student.surname}, ${student.first_name}`,
                  matric_no: student.matric_no,
                })
              )
              return
            }

            res.statusCode = 400
            res.end(JSON.stringify({ success: false, error: `Unknown function: ${fnName}` }))
          } catch (err: any) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: err?.message || 'Server error' }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    adunStudentRpcPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'adun-shield.svg', 'adun-logo.png'],
      manifest: {
        name: 'ADUN Attendance',
        short_name: 'ADUN Attend',
        description: 'Admiralty University of Nigeria - Mobile Attendance Verification System',
        theme_color: '#1E40AF',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/adun-logo.png',
            sizes: '192x192 512x512',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/join/, /^\/attend/, /^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/join') || url.pathname.startsWith('/attend') || url.pathname.startsWith('/api') || url.hostname.includes('supabase'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  build: {
    chunkSizeWarningLimit: 1200,
  }
})
