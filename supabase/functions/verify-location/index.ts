/**
 * Edge Function: verify-location
 * Fixes: SEC-07, SEC-09
 *
 * Strictly verifies student GPS location against the lecture session's exact classroom geofence.
 * Rejects missing/invalid/Null Island coordinates and missing/non-positive GPS accuracy_m.
 * Enforces per-attempt rate limiting to prevent coordinate-oracle brute-forcing.
 * Advances attempt step to 'selfie' ONLY when exact Haversine distance <= session.radius_m
 * and accuracy_m <= threshold (max 65m).
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { isValidCoordinatePair, parseStrictFiniteNumber } from '../_shared/geo.ts';

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

    if (!attemptToken || typeof attemptToken !== 'string' || !attemptToken.trim()) {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_ATTEMPT_TOKEN',
        message: 'attempt_token is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const latitude = parseStrictFiniteNumber(body?.latitude);
    const longitude = parseStrictFiniteNumber(body?.longitude);
    const rawAccuracy = body?.accuracy_m ?? body?.accuracy;
    const accuracyM = parseStrictFiniteNumber(rawAccuracy);

    if (latitude === null || longitude === null || !isValidCoordinatePair(latitude, longitude)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Valid non-zero GPS latitude and longitude coordinates are required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (accuracyM === null || accuracyM <= 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'INVALID_ACCURACY',
        message: 'A valid positive GPS accuracy measurement (accuracy_m > 0) is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    // Per-attempt rate limit (20 requests / 60s) to stop coordinate-oracle brute-forcing
    // without penalizing students sharing campus Wi-Fi NAT IPs.
    const attemptTokenHash = await sha256Hex(attemptToken);
    const { data: rateAllowed } = await supabase.rpc('fn_rate_limit', {
      p_key: `verify_location:attempt:${attemptTokenHash}`,
      p_limit: 20,
      p_window_seconds: 60,
    });

    if (rateAllowed === false) {
      return new Response(JSON.stringify({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many location verification attempts. Please wait a moment and try again.',
      }), {
        status: 429,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

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
        status: isGeofenceUnconfigured ? 400 : 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!result.success) {
      const errCode = (result.error as string) || 'LOCATION_VERIFICATION_FAILED';
      const status =
        errCode === 'OUTSIDE_CAMPUS_BOUNDARY' ||
        errCode === 'OUTSIDE_CLASSROOM_BOUNDARY' ||
        errCode === 'LOW_ACCURACY' ||
        errCode === 'SESSION_CLOSED'
          ? 403
          : errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED'
          ? 410
          : 400;

      return new Response(JSON.stringify({
        success: false,
        error: errCode,
        message: result.message,
        ...(result.distance_m !== undefined ? { distance_m: result.distance_m } : {}),
        ...(result.allowed_radius_m !== undefined ? { allowed_radius_m: result.allowed_radius_m } : {}),
        ...(result.accuracy_m !== undefined ? { accuracy_m: result.accuracy_m } : {}),
        ...(result.max_accuracy_m !== undefined ? { max_accuracy_m: result.max_accuracy_m } : {}),
      }), {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success contract matching Student PWA specification + exact geofence distance telemetry
    return new Response(JSON.stringify({
      success: true,
      inside_boundary: Boolean(result.inside_boundary),
      ...(result.distance_m !== undefined ? { distance_m: result.distance_m } : {}),
      ...(result.allowed_radius_m !== undefined ? { allowed_radius_m: result.allowed_radius_m } : {}),
      ...(result.accuracy_m !== undefined ? { accuracy_m: result.accuracy_m } : {}),
      ...(result.message ? { message: result.message } : {}),
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
