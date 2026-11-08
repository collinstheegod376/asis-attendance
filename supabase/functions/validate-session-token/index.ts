/**
 * Edge Function: validate-session-token
 * Validates session raw token from QR/link, verifies session active state & time window,
 * and creates an ephemeral attendance attempt with a 15-minute TTL.
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
    const token = body?.token || body?.session_token;

    if (!token || typeof token !== 'string') {
      return errorResponse('INVALID_TOKEN', 'Session token is required.', 400);
    }

    const supabase = getServiceClient();

    // Invoke atomic transactional RPC
    const { data, error } = await supabase.rpc('rpc_validate_session_token', {
      p_raw_token: token.trim(),
    });

    if (error) {
      console.error('RPC Error in validate-session-token:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500);
    }

    const result = data as Record<string, unknown>;

    if (!result.success) {
      const errCode = (result.error as string) || 'VALIDATION_FAILED';
      const status =
        errCode === 'SESSION_EXPIRED'
          ? 410
          : errCode === 'SESSION_NOT_STARTED'
          ? 425
          : errCode === 'SESSION_CLOSED' || errCode === 'COURSE_ARCHIVED'
          ? 403
          : 400;

      return jsonResponse(result, status);
    }

    return jsonResponse(result, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return errorResponse('INTERNAL_SERVER_ERROR', message, 500);
  }
});
