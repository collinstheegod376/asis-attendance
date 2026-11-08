/**
 * Edge Function: verify-location
 * Verifies student GPS coordinates, compares accuracy against configured threshold,
 * checks point-in-polygon if campus boundary GeoJSON is active, and applies
 * enforcement or evidence-only rules per institutional settings.
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'POST method required', 405);
  }

  try {
    const body = await req.json();
    const attemptId = body?.attempt_id;
    const attemptToken = body?.attempt_token || req.headers.get('x-attempt-token');
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    const accuracyM = Number(body?.accuracy_m ?? body?.accuracy);

    if (!attemptId || !attemptToken) {
      return errorResponse('BAD_REQUEST', 'attempt_id and attempt_token are required.', 400);
    }

    if (isNaN(latitude) || isNaN(longitude) || isNaN(accuracyM)) {
      return errorResponse('BAD_REQUEST', 'Valid latitude, longitude, and accuracy_m are required numbers.', 400);
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase.rpc('rpc_verify_location', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy_m: accuracyM,
    });

    if (error) {
      console.error('RPC Error in verify-location:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500);
    }

    const result = data as Record<string, unknown>;

    if (!result.success) {
      const errCode = (result.error as string) || 'LOCATION_VERIFICATION_FAILED';
      const status =
        errCode === 'OUTSIDE_CAMPUS_BOUNDARY' || errCode === 'LOW_ACCURACY'
          ? 403
          : errCode === 'ATTEMPT_EXPIRED'
          ? 410
          : 400;

      return jsonResponse(result, status);
    }

    return jsonResponse(result, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return errorResponse('INTERNAL_SERVER_ERROR', message, 500);
  }
});
