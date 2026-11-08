/**
 * Edge Function: lookup-matric
 * Validates check-in attempt token, normalizes matric number, looks up student in
 * students_master, checks eligibility on course_roster, verifies no prior sign-in,
 * and validates soft device binding against matric collisions.
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabaseClient.ts';
import { normalizeMatric } from '../_shared/crypto.ts';

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
    const matricNo = body?.matric_no || body?.matric;
    const deviceId = body?.device_id || '';

    if (!attemptId || !attemptToken) {
      return errorResponse('BAD_REQUEST', 'attempt_id and attempt_token are required.', 400);
    }

    if (!matricNo || typeof matricNo !== 'string') {
      return errorResponse('BAD_REQUEST', 'matric_no is required.', 400);
    }

    const cleanMatric = normalizeMatric(matricNo);
    const supabase = getServiceClient();

    // Call atomic RPC
    const { data, error } = await supabase.rpc('rpc_lookup_matric', {
      p_attempt_id: attemptId,
      p_attempt_token: attemptToken,
      p_raw_matric: cleanMatric,
      p_device_id: deviceId,
    });

    if (error) {
      console.error('RPC Error in lookup-matric:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500);
    }

    const result = data as Record<string, unknown>;

    if (!result.success) {
      const errCode = (result.error as string) || 'LOOKUP_FAILED';
      const status =
        errCode === 'ALREADY_SIGNED'
          ? 409
          : errCode === 'NOT_ON_ROSTER'
          ? 403
          : errCode === 'DEVICE_BOUND_TO_ANOTHER_MATRIC'
          ? 423 // Locked
          : errCode === 'STUDENT_NOT_FOUND'
          ? 404
          : errCode === 'ATTEMPT_EXPIRED' || errCode === 'SESSION_EXPIRED'
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
