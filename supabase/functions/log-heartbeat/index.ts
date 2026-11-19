/**
 * Edge Function: log-heartbeat
 *
 * Logs periodic student location heartbeats and optional failed client events
 * during an active check-in attempt. Validates attempt_token, enforces per-attempt
 * rate limiting (1/60s), strictly validates GPS coordinates & accuracy, and
 * delegates to rpc_log_heartbeat.
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
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');

    if (!attemptToken || typeof attemptToken !== 'string' || !attemptToken.trim()) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_ATTEMPT_TOKEN',
          message: 'attempt_token is required.',
        }),
        {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = getServiceClient();

    // 1. Resolve attempt by hashed attempt_token and verify it is active
    const attemptTokenHash = await sha256Hex(attemptToken);
    const { data: attempt, error: attemptErr } = await supabase
      .from('attendance_attempts')
      .select('id, expires_at, completed_at')
      .eq('attempt_token_hash', attemptTokenHash)
      .maybeSingle();

    if (attemptErr || !attempt) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_ATTEMPT',
          message: 'Invalid or expired check-in attempt.',
        }),
        {
          status: 401,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (new Date().toISOString() >= attempt.expires_at || attempt.completed_at) {
      return new Response(
        JSON.stringify({
          error: 'ATTEMPT_EXPIRED',
          message: 'This check-in attempt has expired or is already completed.',
        }),
        {
          status: 410,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Per-attempt rate limit (1 request per 60 seconds)
    const { data: rateAllowed } = await supabase.rpc('rpc_check_rate_limit', {
      p_key: `log_heartbeat:${attempt.id}`,
      p_limit: 1,
      p_window_seconds: 60,
    });

    if (
      rateAllowed === false ||
      (typeof rateAllowed === 'object' && rateAllowed !== null && rateAllowed.allowed === false)
    ) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Heartbeat rate limit exceeded. Maximum 1 heartbeat per 60 seconds.',
        }),
        {
          status: 429,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Validate lat, lon, accuracy_m, and optional failed_events
    const lat = parseStrictFiniteNumber(body?.lat ?? body?.latitude);
    const lon = parseStrictFiniteNumber(body?.lon ?? body?.longitude);
    const accuracyM = parseStrictFiniteNumber(body?.accuracy_m ?? body?.accuracy);

    if (lat === null || lon === null || !isValidCoordinatePair(lat, lon)) {
      return new Response(
        JSON.stringify({
          error: 'BAD_REQUEST',
          message: 'Valid non-zero GPS lat and lon coordinates are required.',
        }),
        {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (accuracyM === null || accuracyM <= 0) {
      return new Response(
        JSON.stringify({
          error: 'INVALID_ACCURACY',
          message: 'A valid positive GPS accuracy measurement (accuracy_m > 0) is required.',
        }),
        {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (
      body?.failed_events !== undefined &&
      body?.failed_events !== null &&
      !Array.isArray(body.failed_events)
    ) {
      return new Response(
        JSON.stringify({
          error: 'BAD_REQUEST',
          message: 'failed_events must be an array when provided.',
        }),
        {
          status: 400,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const failedEvents = Array.isArray(body?.failed_events) ? body.failed_events : [];

    // 4. Call rpc_log_heartbeat
    const { data: result, error: rpcErr } = await supabase.rpc('rpc_log_heartbeat', {
      p_attempt_id: attempt.id,
      p_lat: lat,
      p_lon: lon,
      p_accuracy_m: accuracyM,
      p_failed_events: failedEvents,
    });

    if (rpcErr || !result) {
      console.error('RPC Error in log-heartbeat:', rpcErr);
      return new Response(
        JSON.stringify({
          error: 'DATABASE_ERROR',
          message: rpcErr?.message || 'Database error occurred while logging heartbeat.',
        }),
        {
          status: 500,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (result.success === false || result.ok === false || result.error) {
      const errCode = (result.error as string) || 'HEARTBEAT_FAILED';
      const status =
        errCode === 'SESSION_ENDED' ||
        errCode === 'SESSION_EXPIRED' ||
        errCode === 'ATTEMPT_EXPIRED'
          ? 410
          : errCode === 'SESSION_CLOSED'
          ? 403
          : errCode === 'SESSION_NOT_FOUND'
          ? 404
          : 400;

      return new Response(
        JSON.stringify({
          error: errCode,
          message: result.message || 'Unable to log heartbeat.',
        }),
        {
          status,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        inside_fence: Boolean(result.inside_fence),
        distance_m: result.distance_m ?? null,
      }),
      {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
