const https = require('https');
const crypto = require('crypto');

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ijfljngylbzwyyikivob';
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.MGMT_TOKEN || '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmxqbmd5bGJ6d3l5aWtpdm9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQxNjg2NzMsImV4cCI6MjEwOTc0NDY3M30.XBZ81gCEPnR0pGhLSJQGiLeaAMkAcUoTbxLMhCpepD4';
const FUNCTIONS_URL = `https://${PROJECT_REF}.supabase.co/functions/v1`;

function executeSql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MGMT_TOKEN}`,
        },
        family: 4,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`SQL Error (${res.statusCode}): ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse SQL response: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function callFunction(name, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const url = new URL(`${FUNCTIONS_URL}/${name}`);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
          ...headers,
        },
        family: 4,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, headers: res.headers, data: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, headers: res.headers, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runGeofenceTests() {
  console.log('================================================================================');
  console.log('ADUN 50M CLASSROOM GEOFENCE & REGRESSION TEST RUNNER');
  console.log('================================================================================\n');

  const results = [];
  function assert(name, condition, details = '') {
    results.push({ name, passed: Boolean(condition), details });
    console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name} ${details ? '(' + details + ')' : ''}`);
    if (!condition) {
      throw new Error(`Assertion failed: ${name} - ${details}`);
    }
  }

  let sessionWithGeofenceId = null;
  let sessionWithoutGeofenceId = null;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Schema Verification
    // -------------------------------------------------------------------------
    console.log('[TEST 1] Verifying public.lecture_sessions schema columns...');
    const columns = await executeSql(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'lecture_sessions';
    `);

    const colMap = new Map(columns.map(c => [c.column_name, c]));
    assert('Column latitude exists', colMap.has('latitude'), `type: ${colMap.get('latitude')?.data_type}`);
    assert('Column longitude exists', colMap.has('longitude'), `type: ${colMap.get('longitude')?.data_type}`);
    assert('Column radius_m exists', colMap.has('radius_m'), `default: ${colMap.get('radius_m')?.column_default}`);
    assert('Column location_name exists', colMap.has('location_name'), `type: ${colMap.get('location_name')?.data_type}`);

    // Select course CYB 104
    const courses = await executeSql("SELECT id, code FROM public.courses WHERE code = 'CYB 104' LIMIT 1;");
    const courseId = courses[0].id;

    // -------------------------------------------------------------------------
    // TEST 2: Create Session With 50m Classroom Coordinates
    // -------------------------------------------------------------------------
    console.log('\n[TEST 2] Creating test session with 50m classroom geofence (lat: 6.11180, lng: 6.60110, radius: 50.0m)...');
    const token1 = 'TEST_GF_INSIDE_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const tokenHash1 = crypto.createHash('sha256').update(token1).digest('hex');

    const s1Res = await executeSql(`
      INSERT INTO public.lecture_sessions (
        course_id, title, token_hash, starts_at, expires_at, grace_minutes, status, created_by,
        latitude, longitude, radius_m, location_name
      ) VALUES (
        '${courseId}',
        'Classroom Geofence 50m Live Test',
        '${tokenHash1}',
        NOW() - INTERVAL '2 minutes',
        NOW() + INTERVAL '30 minutes',
        10,
        'active',
        '00000000-0000-0000-0000-000000000002',
        6.11180,
        6.60110,
        50.0,
        'Science Complex Hall A'
      ) RETURNING id;
    `);
    sessionWithGeofenceId = s1Res[0].id;
    assert('Session with 50m geofence created in DB', Boolean(sessionWithGeofenceId), `id: ${sessionWithGeofenceId}`);

    // -------------------------------------------------------------------------
    // TEST 3: Student Inside 50m Radius (~11 meters away: lat: 6.11190, lng: 6.60110)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 3] Testing student location INSIDE 50m radius (lat: 6.11190, lng: 6.60110 -> ~11.1m away)...');
    const step1A = await callFunction('validate-session-token', { token: token1 });
    assert('Validate session token returns 200', step1A.status === 200);
    const attempt1Token = step1A.data.attempt_token;
    const attempt1Id = step1A.data.attempt_id;

    const locInsideRes = await callFunction('verify-location', {
      attempt_token: attempt1Token,
      latitude: 6.11190,
      longitude: 6.60110,
      accuracy_m: 10.0,
    });
    console.log('Location Inside 50m Response:', locInsideRes.data);
    assert('Inside 50m returns HTTP 200', locInsideRes.status === 200);
    assert('Inside 50m returns success: true', locInsideRes.data.success === true);
    assert('Inside 50m returns inside_boundary: true', locInsideRes.data.inside_boundary === true);

    // Verify database attempt step advanced to 'selfie'
    const attempt1Db = await executeSql(`SELECT step, latitude, longitude FROM public.attendance_attempts WHERE id = '${attempt1Id}';`);
    assert('Attempt step advanced to "selfie" in DB', attempt1Db[0].step === 'selfie');
    assert('Attempt latitude saved', Math.abs(attempt1Db[0].latitude - 6.11190) < 0.0001);

    // -------------------------------------------------------------------------
    // TEST 4: Student Outside 50m Radius (~122 meters away: lat: 6.11290, lng: 6.60110)
    // -------------------------------------------------------------------------
    console.log('\n[TEST 4] Testing student location OUTSIDE 50m radius (lat: 6.11290, lng: 6.60110 -> ~122.3m away)...');
    const step1B = await callFunction('validate-session-token', { token: token1 });
    assert('Validate session token for outside test returns 200', step1B.status === 200);
    const attempt2Token = step1B.data.attempt_token;
    const attempt2Id = step1B.data.attempt_id;

    const locOutsideRes = await callFunction('verify-location', {
      attempt_token: attempt2Token,
      latitude: 6.11290,
      longitude: 6.60110,
      accuracy_m: 10.0,
    });
    console.log('Location Outside 50m Response:', locOutsideRes.data);
    assert('Outside 50m returns HTTP 403 or 400', locOutsideRes.status === 403 || locOutsideRes.status === 400);
    assert('Outside 50m returns success: false', locOutsideRes.data.success === false);
    assert('Outside 50m returns error: "OUTSIDE_CLASSROOM_BOUNDARY"', locOutsideRes.data.error === 'OUTSIDE_CLASSROOM_BOUNDARY');
    assert('Outside 50m indicates classroom distance constraint', locOutsideRes.data.distance_m !== undefined || locOutsideRes.data.message.includes('meters'));
    assert('Outside 50m message contains classroom explanation', locOutsideRes.data.message.includes('outside the classroom'));

    // Verify attempt step was NOT advanced to 'selfie'
    const attempt2Db = await executeSql(`SELECT step FROM public.attendance_attempts WHERE id = '${attempt2Id}';`);
    assert('Attempt step did NOT advance to "selfie"', attempt2Db[0].step !== 'selfie');

    // -------------------------------------------------------------------------
    // TEST 5: Fallback: Session WITHOUT coordinates falls back to settings campus boundary
    // -------------------------------------------------------------------------
    console.log('\n[TEST 5] Testing session fallback (Session with latitude = null, longitude = null)...');
    const tokenFallback = 'TEST_FALLBACK_' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const tokenHashFallback = crypto.createHash('sha256').update(tokenFallback).digest('hex');

    const sFallbackRes = await executeSql(`
      INSERT INTO public.lecture_sessions (
        course_id, title, token_hash, starts_at, expires_at, grace_minutes, status, created_by,
        latitude, longitude, radius_m, location_name
      ) VALUES (
        '${courseId}',
        'Fallback Campus Geofence Live Test',
        '${tokenHashFallback}',
        NOW() - INTERVAL '2 minutes',
        NOW() + INTERVAL '30 minutes',
        10,
        'active',
        '00000000-0000-0000-0000-000000000002',
        NULL,
        NULL,
        50.0,
        NULL
      ) RETURNING id;
    `);
    sessionWithoutGeofenceId = sFallbackRes[0].id;

    const stepFallback = await callFunction('validate-session-token', { token: tokenFallback });
    const attemptFallbackToken = stepFallback.data.attempt_token;
    const attemptFallbackId = stepFallback.data.attempt_id;

    // Test location within ADUN campus perimeter (6.11180, 6.60110)
    const fallbackInsideRes = await callFunction('verify-location', {
      attempt_token: attemptFallbackToken,
      latitude: 6.11180,
      longitude: 6.60110,
      accuracy_m: 10.0,
    });
    console.log('Fallback Inside Campus Response:', fallbackInsideRes.data);
    assert('Fallback inside campus returns HTTP 200', fallbackInsideRes.status === 200);
    assert('Fallback inside campus returns success: true', fallbackInsideRes.data.success === true);
    assert('Fallback inside campus returns inside_boundary: true', fallbackInsideRes.data.inside_boundary === true);

    const attemptFallbackDb = await executeSql(`SELECT step FROM public.attendance_attempts WHERE id = '${attemptFallbackId}';`);
    assert('Fallback attempt step advanced to "selfie"', attemptFallbackDb[0].step === 'selfie');

    // Test location far outside campus (Lagos: 6.5244, 3.3792 -> ~300km away)
    const stepFar = await callFunction('validate-session-token', { token: tokenFallback });
    const attemptFarToken = stepFar.data.attempt_token;
    const fallbackFarRes = await callFunction('verify-location', {
      attempt_token: attemptFarToken,
      latitude: 6.5244,
      longitude: 3.3792,
      accuracy_m: 10.0,
    });
    console.log('Fallback Far Outside Campus Response:', fallbackFarRes.data);
    assert('Fallback far outside campus returns HTTP 403 or 400', fallbackFarRes.status === 403 || fallbackFarRes.status === 400);
    assert('Fallback far outside campus returns success: false', fallbackFarRes.data.success === false);
    assert('Fallback far outside campus returns error: "OUTSIDE_CAMPUS_BOUNDARY"', fallbackFarRes.data.error === 'OUTSIDE_CAMPUS_BOUNDARY');

    console.log('\n================================================================================');
    console.log('ALL 50M GEOFENCE VERIFICATION & FALLBACK TESTS PASSED FLAWLESSLY! 🎯');
    console.log('================================================================================\n');
  } finally {
    // Cleanup sessions
    if (sessionWithGeofenceId) {
      console.log('Cleaning up sessionWithGeofenceId...');
      await executeSql(`DELETE FROM public.attendance_records WHERE session_id = '${sessionWithGeofenceId}';`);
      await executeSql(`DELETE FROM public.attendance_attempts WHERE session_id = '${sessionWithGeofenceId}';`);
      await executeSql(`DELETE FROM public.lecture_sessions WHERE id = '${sessionWithGeofenceId}';`);
    }
    if (sessionWithoutGeofenceId) {
      console.log('Cleaning up sessionWithoutGeofenceId...');
      await executeSql(`DELETE FROM public.attendance_records WHERE session_id = '${sessionWithoutGeofenceId}';`);
      await executeSql(`DELETE FROM public.attendance_attempts WHERE session_id = '${sessionWithoutGeofenceId}';`);
      await executeSql(`DELETE FROM public.lecture_sessions WHERE id = '${sessionWithoutGeofenceId}';`);
    }
    console.log('Cleanup completed.');
  }
}

runGeofenceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('GEOFENCE TEST SUITE ERROR:', err);
    process.exit(1);
  });
