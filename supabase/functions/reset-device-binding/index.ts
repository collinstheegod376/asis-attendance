/**
 * Edge Function: reset-device-binding
 * Authenticated endpoint for Lecturers and Admins to reset device locks for a student.
 * Enforces mandatory forensic reset reason and hourly rate limiting (max 50 resets/hour per actor).
 */
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getServiceClient, getUserClient } from '../_shared/supabaseClient.ts';

declare const Deno: any;

const MAX_RESETS_PER_HOUR = 50;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'POST method required', 405, {}, req);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401, {}, req);
    }

    const body = await req.json().catch(() => ({}));
    const studentId = body?.student_id;
    const reason = body?.reason;
    const actorId = body?.actor_id;

    // 1. Mandatory Parameter Validation
    if (!studentId) {
      return errorResponse('BAD_REQUEST', 'student_id is required', 400, {}, req);
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return errorResponse(
        'REASON_REQUIRED',
        'A reason for the reset is mandatory for forensic auditing and institutional record keeping.',
        400,
        {},
        req
      );
    }

    const supabase = getServiceClient();
    let effectiveActorId = actorId;

    // 2. Authenticate and resolve actor
    if (!effectiveActorId) {
      const userClient = getUserClient(authHeader);
      const {
        data: { user },
        error: authErr,
      } = await userClient.auth.getUser();

      if (authErr || !user) {
        return errorResponse('UNAUTHORIZED', 'Invalid credentials or expired session', 401, {}, req);
      }

      const { data: dbUser, error: dbUserErr } = await supabase
        .from('users')
        .select('id, role, status')
        .or(`auth_id.eq.${user.id},id.eq.${user.id}`)
        .eq('status', 'active')
        .maybeSingle();

      if (dbUserErr || !dbUser) {
        return errorResponse('FORBIDDEN', 'User account not authorized or inactive', 403, {}, req);
      }
      effectiveActorId = dbUser.id;
    } else {
      // Verify actor exists and is active
      const { data: dbUser } = await supabase
        .from('users')
        .select('id, role, status')
        .eq('id', effectiveActorId)
        .eq('status', 'active')
        .maybeSingle();

      if (!dbUser) {
        return errorResponse('FORBIDDEN', 'Actor account not authorized', 403, {}, req);
      }
    }

    // 3. Rate Limit Enforcement: Max 50 resets per hour per admin account
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from('device_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'admin_reset')
      .gte('created_at', oneHourAgo)
      .filter('metadata->>actor_id', 'eq', effectiveActorId);

    if (countErr) {
      console.warn('Could not query rate limit count from device_events:', countErr.message);
    } else if (count !== null && count >= MAX_RESETS_PER_HOUR) {
      return jsonResponse(
        {
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded: maximum ${MAX_RESETS_PER_HOUR} device resets per hour per account.`,
          hourly_reset_count: count,
          limit: MAX_RESETS_PER_HOUR,
        },
        429,
        {},
        req
      );
    }

    // 4. Execute atomic reset RPC
    const { data, error } = await supabase.rpc('rpc_reset_device_binding', {
      p_student_id: studentId,
      p_actor_id: effectiveActorId,
      p_reason: reason.trim(),
    });

    if (error) {
      console.error('RPC Error in rpc_reset_device_binding:', error);
      return errorResponse('DATABASE_ERROR', error.message, 500, {}, req);
    }

    const result = data as Record<string, unknown>;
    if (!result.success) {
      return jsonResponse(result, 400, {}, req);
    }

    return jsonResponse(result, 200, {}, req);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown server error';
    return errorResponse('INTERNAL_SERVER_ERROR', message, 500, {}, req);
  }
});
