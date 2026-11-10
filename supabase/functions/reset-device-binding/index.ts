/**
 * Edge Function: reset-device-binding
 * Fixes: SEC-15
 *
 * Authenticated endpoint for Admins and Lecturers to reset device locks.
 * Strictly verifies identity via Supabase Auth JWT (userClient.auth.getUser()).
 * NEVER trusts or reads actor_id from request body.
 * Enforces course roster authorization and role-based rate limits.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getUserClient } from '../_shared/supabaseClient.ts';

declare const Deno: any;

function isValidUuid(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

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
    // 1. Mandatory Authorization Header Check (SEC-15)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({
        error: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header.',
      }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Authenticate caller strictly via Supabase Auth service
    const userClient = getUserClient(authHeader);
    const { data: { user }, error: authErr } = await userClient.auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({
        error: 'UNAUTHORIZED',
        message: 'Invalid, revoked, or expired auth token.',
      }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    // 3. Resolve caller profile in users table
    const { data: dbUser, error: dbUserErr } = await supabase
      .from('users')
      .select('id, role, status')
      .or(`auth_id.eq.${user.id},id.eq.${user.id}`)
      .eq('status', 'active')
      .maybeSingle();

    if (dbUserErr || !dbUser) {
      return new Response(JSON.stringify({
        error: 'FORBIDDEN',
        message: 'Caller account is not registered or is inactive.',
      }), {
        status: 403,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Validate parameters (Reject or ignore any body.actor_id or body.role)
    const body = await req.json().catch(() => ({}));
    const studentId = body?.student_id;
    const reason = body?.reason;

    if (!studentId || !isValidUuid(studentId)) {
      return new Response(JSON.stringify({
        error: 'BAD_REQUEST',
        message: 'Valid student_id UUID is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return new Response(JSON.stringify({
        error: 'REASON_REQUIRED',
        message: 'A detailed forensic reason for the reset is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Execute atomic database RPC with verified actor identity
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     req.headers.get('cf-connecting-ip') ||
                     req.headers.get('x-real-ip') ||
                     null;

    let result: any = null;
    let rpcErr: any = null;

    // Primary invocation: matches 4-parameter overload (p_student_id, p_actor_id, p_actor_role, p_reason)
    const call1 = await supabase.rpc('rpc_reset_device_binding', {
      p_student_id: studentId,
      p_actor_id: dbUser.id,
      p_actor_role: dbUser.role,
      p_reason: reason.trim(),
    });

    result = call1.data;
    rpcErr = call1.error;

    // Graceful fallback to 5-parameter signature if 4-parameter overload fails
    if (rpcErr && (rpcErr.code === 'PGRST202' || rpcErr.code === 'PGRST203')) {
      console.warn('Retrying rpc_reset_device_binding with 5-parameter signature (p_role, p_actor_ip)...');
      const call2 = await supabase.rpc('rpc_reset_device_binding', {
        p_student_id: studentId,
        p_actor_id: dbUser.id,
        p_reason: reason.trim(),
        p_actor_ip: clientIp,
        p_role: dbUser.role,
      });
      result = call2.data;
      rpcErr = call2.error;
    }

    if (rpcErr || !result) {
      console.error('RPC Error in rpc_reset_device_binding:', rpcErr);
      const isParamMismatch = rpcErr?.code === 'PGRST202' || rpcErr?.code === 'PGRST203';
      return new Response(JSON.stringify({
        error: isParamMismatch ? 'RPC_SCHEMA_MISMATCH' : 'DATABASE_ERROR',
        message: isParamMismatch
          ? 'Database stored procedure signature mismatch. Please ensure migration 20261110000004 is applied.'
          : (rpcErr?.message || 'Database error occurred during device reset.'),
        details: rpcErr?.details || null,
      }), {
        status: 500,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!result.success) {
      const errCode = (result.error as string) || 'RESET_FAILED';
      const status =
        errCode === 'FORBIDDEN'
          ? 403
          : errCode === 'RATE_LIMIT_EXCEEDED'
          ? 429
          : 400;

      return new Response(JSON.stringify({
        error: errCode,
        message: result.message,
      }), {
        status,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reset_count: result.reset_count ?? 1,
      student_id: studentId,
    }), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown internal error';
    return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR', message }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
});
