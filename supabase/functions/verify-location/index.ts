/**
 * Edge Function: verify-location
 * Fixes: SEC-07, SEC-09
 *
 * Verifies student GPS location against institutional campus boundary (GeoJSON or Haversine circle).
 * Enforces accuracy threshold check and returns ATTEMPT_EXPIRED or GEOFENCE_NOT_CONFIGURED.
 * Advances attempt step to 'selfie'.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';

declare const Deno: any;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const baseHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const attemptId = body?.attempt_id || null;
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    const accuracyM = Number(body?.accuracy_m ?? body?.accuracy);

    if (!attemptToken || typeof attemptToken !== 'string') {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_ATTEMPT_TOKEN',
        message: 'attempt_token is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (isNaN(latitude) || isNaN(longitude) || isNaN(accuracyM)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Valid latitude, longitude, and accuracy_m numbers are required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    const { data: result, error: rpcErr } = await supabase.rpc('rpc_verify_location', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in verify-location:', rpcErr);
      const isGeofenceUnconfigured = rpcErr?.message?.includes('GEOFENCE_NOT_CONFIGURED');
      return new Response(JSON.stringify({
        success: false,
        error: isGeofenceUnconfigured ? 'GEOFENCE_NOT_CONFIGURED' : 'DATABASE_ERROR',
        message: rpcErr?.message || 'Database error occurred during location verification.',
      }), {
        status: isGeofenceUnconfigured ? 500 : 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!result.success) {
      const errCode = (result.error as string) || 'LOCATION_VERIFICATION_FAILED';
      const status =
        errCode === 'OUTSIDE_CAMPUS_BOUNDARY' || errCode === 'LOW_ACCURACY'
          ? 403
          : errCode === 'ATTEMPT_EXPIRED'
          ? 410
          : 400;

      return new Response(JSON.stringify({
        success: false,
        error: errCode,
        message: result.message,
      }), {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success contract matching Agent 2 specification
    return new Response(JSON.stringify({
      success: true,
      inside_boundary: Boolean(result.inside_boundary),
    }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ success: false, error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
