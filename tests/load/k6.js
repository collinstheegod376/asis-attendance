import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * ADUN Attendance System - 120 Concurrent Virtual Students Load Test
 * File: tests/load/k6.js
 * Modeled after actual classroom attendance rush at Admiralty University of Nigeria.
 *
 * Target: 120 students concurrently entering the classroom and submitting attendance.
 * Acceptance criteria:
 *   - Error rate < 1.0%
 *   - p95 latency for POST /api/submit-attendance < 2000ms
 */

// Custom metrics
const submitLatencyTrend = new Trend('submit_attendance_duration');
const uploadLatencyTrend = new Trend('upload_selfie_duration');
const deviceCheckLatencyTrend = new Trend('device_check_duration');
const locationLatencyTrend = new Trend('verify_location_duration');
const matricLookupLatencyTrend = new Trend('lookup_matric_duration');
const errorRate = new Rate('system_error_rate');
const successfulCheckins = new Counter('successful_checkins');

export const options = {
  stages: [
    { duration: '60s', target: 120 }, // Ramp up to 120 concurrent students over 1 minute
    { duration: '9m', target: 120 },  // Sustained load of 120 concurrent students for 9 minutes
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    'system_error_rate': ['rate<0.01'], // Acceptance: Error rate < 1%
    'submit_attendance_duration': ['p(95)<2000', 'p(99)<3000'], // Acceptance: p95 < 2s
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'https://attendance.adun.edu.ng';
const SESSION_TOKEN = __ENV.SESSION_TOKEN || 'adun-live-session-csc201';

// Simulated 50KB selfie binary buffer
const dummySelfiePayload = 'A'.repeat(50 * 1024);

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const matric = `U2024/CS/${1000 + (vuId % 300)}`;
  const localDeviceId = `device-vu-${vuId}-${iterId}`;
  const rawFingerprint = `fingerprint-seed-${vuId}-gpu-canvas-webgl`;

  let attemptToken = '';
  let cookieHeader = '';

  // ---------------------------------------------------------------------------
  // Step 1: GET /join/:token (QR Scan landing)
  // ---------------------------------------------------------------------------
  group('01_join_session', function () {
    const res = http.get(`${BASE_URL}/join/${SESSION_TOKEN}`);
    check(res, {
      'join status is 200 or 302': (r) => r.status === 200 || r.status === 302,
    });
    sleep(0.5);
  });

  // ---------------------------------------------------------------------------
  // Step 2: POST /api/validate-session-token (Initializes attempt)
  // ---------------------------------------------------------------------------
  group('02_validate_session', function () {
    const res = http.post(
      `${BASE_URL}/api/validate-session-token`,
      JSON.stringify({ session_token: SESSION_TOKEN }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    const success = check(res, {
      'validate session returned 200': (r) => r.status === 200,
    });
    if (!success) {
      errorRate.add(1);
      return;
    }
    const body = res.json();
    attemptToken = body.attempt_token || `att-vu-${vuId}-${Date.now()}`;
    sleep(0.4);
  });

  // ---------------------------------------------------------------------------
  // Step 3: POST /api/lookup-matric (Debounced identity lookup)
  // ---------------------------------------------------------------------------
  group('03_lookup_matric', function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/lookup-matric`,
      JSON.stringify({ matric_number: matric, attempt_token: attemptToken }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    matricLookupLatencyTrend.add(Date.now() - start);

    const success = check(res, {
      'lookup status is 200': (r) => r.status === 200,
      'student name returned': (r) => r.json('full_name') !== undefined,
    });
    if (!success) errorRate.add(1);
    sleep(0.8);
  });

  // ---------------------------------------------------------------------------
  // Step 4: POST /api/device-check (Hardware binding & cookie issuance)
  // ---------------------------------------------------------------------------
  group('04_device_check', function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/device-check`,
      JSON.stringify({
        matric_number: matric,
        local_device_id: localDeviceId,
        fingerprint_hash: rawFingerprint,
        incognito_signal: false,
        attempt_token: attemptToken,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    deviceCheckLatencyTrend.add(Date.now() - start);

    const success = check(res, {
      'device check returned 200': (r) => r.status === 200,
      'device action is OK': (r) => r.json('action') === 'OK',
    });
    if (!success) errorRate.add(1);

    // Capture Set-Cookie if returned by first-party proxy
    const setCookie = res.headers['Set-Cookie'];
    if (setCookie) {
      cookieHeader = setCookie.split(';')[0];
    }
    sleep(0.5);
  });

  // ---------------------------------------------------------------------------
  // Step 5: POST /api/verify-location (Geofence validation inside ADUN)
  // ---------------------------------------------------------------------------
  group('05_verify_location', function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/verify-location`,
      JSON.stringify({
        latitude: 6.33501,
        longitude: 5.60372,
        accuracy: 12.5,
        attempt_token: attemptToken,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
      }
    );
    locationLatencyTrend.add(Date.now() - start);

    const success = check(res, {
      'location returned 200': (r) => r.status === 200,
      'location verified inside': (r) => r.json('verified') === true,
    });
    if (!success) errorRate.add(1);
    sleep(1.0);
  });

  // ---------------------------------------------------------------------------
  // Step 6: POST /api/upload-selfie (50KB upload)
  // ---------------------------------------------------------------------------
  let selfieStoragePath = '';
  group('06_upload_selfie', function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/upload-selfie`,
      JSON.stringify({
        attempt_token: attemptToken,
        image_base64: dummySelfiePayload,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
      }
    );
    uploadLatencyTrend.add(Date.now() - start);

    const success = check(res, {
      'selfie upload returned 200': (r) => r.status === 200,
      'selfie storage path returned': (r) => r.json('selfie_path') !== undefined,
    });
    if (success) {
      selfieStoragePath = res.json('selfie_path');
    } else {
      errorRate.add(1);
    }
    sleep(0.6);
  });

  // ---------------------------------------------------------------------------
  // Step 7: POST /api/submit-attendance (Final 64-bit locked transaction)
  // ---------------------------------------------------------------------------
  group('07_submit_attendance', function () {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/submit-attendance`,
      JSON.stringify({
        attempt_token: attemptToken,
        matric_number: matric,
        selfie_path: selfieStoragePath,
        idempotency_key: `idemp-${attemptToken}`,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
      }
    );
    const duration = Date.now() - start;
    submitLatencyTrend.add(duration);

    const success = check(res, {
      'submit attendance returned 200': (r) => r.status === 200,
      'receipt number returned': (r) => r.json('receipt_number') !== undefined,
    });

    if (success) {
      successfulCheckins.add(1);
      errorRate.add(0);
    } else {
      errorRate.add(1);
    }
  });

  // Realistic think time between subsequent iterations
  sleep(2.0);
}
