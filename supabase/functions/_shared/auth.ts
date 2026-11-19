/**
 * ADUN Attendance - Staff Authentication & Course Ownership Helpers
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { getUserClient } from './supabaseClient.ts';

export interface StaffUser {
  id: string;
  role: 'lecturer' | 'admin';
  status: string;
}

export function isValidUuid(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
}

export async function authenticateStaffCaller(
  req: Request,
  supabase: SupabaseClient,
  baseHeaders: Record<string, string>
): Promise<{ user: StaffUser; errorResponse?: never } | { user?: never; errorResponse: Response }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header.',
        }),
        {
          status: 401,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      ),
    };
  }

  const userClient = getUserClient(authHeader);
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();

  if (authErr || !user) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'UNAUTHORIZED',
          message: 'Invalid, revoked, or expired auth token.',
        }),
        {
          status: 401,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      ),
    };
  }

  const { data: dbUser, error: dbUserErr } = await supabase
    .from('users')
    .select('id, role, status')
    .or(`auth_id.eq.${user.id},id.eq.${user.id}`)
    .eq('status', 'active')
    .maybeSingle();

  if (dbUserErr || !dbUser || (dbUser.role !== 'lecturer' && dbUser.role !== 'admin')) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'FORBIDDEN',
          message: 'Caller account is not an active lecturer or admin.',
        }),
        {
          status: 403,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      ),
    };
  }

  return { user: dbUser as StaffUser };
}

export async function verifySessionOwnership(
  supabase: SupabaseClient,
  sessionId: string,
  staffUser: StaffUser,
  baseHeaders: Record<string, string>
): Promise<{ sessionId: string; courseId: string; errorResponse?: never } | { errorResponse: Response }> {
  const { data: session, error: sessionErr } = await supabase
    .from('lecture_sessions')
    .select('id, course_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionErr || !session) {
    return {
      errorResponse: new Response(
        JSON.stringify({
          error: 'SESSION_NOT_FOUND',
          message: 'Lecture session not found.',
        }),
        {
          status: 404,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        }
      ),
    };
  }

  if (staffUser.role === 'lecturer') {
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('lecturer_id')
      .eq('id', session.course_id)
      .maybeSingle();

    if (courseErr || !course || course.lecturer_id !== staffUser.id) {
      return {
        errorResponse: new Response(
          JSON.stringify({
            error: 'FORBIDDEN',
            message: 'You do not have permission to manage this lecture session.',
          }),
          {
            status: 403,
            headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          }
        ),
      };
    }
  }

  return { sessionId: session.id, courseId: session.course_id };
}
