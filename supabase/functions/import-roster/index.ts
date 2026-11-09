/**
 * Edge Function: import-roster (NEW)
 * Fixes: SEC-01, SEC-18, QA-02, QA-03
 *
 * Course roster bulk import handler for Agent 3 (Admin Portal).
 * Requires JWT authentication (Admin or owning Lecturer).
 * Bulk queries students_master by normalized matriculation numbers.
 * Rejects unknown matric numbers with row indices and descriptive reasons.
 * NEVER inserts or modifies students_master (Verification Item 16).
 * Atomically inserts accepted students into course_roster.
 */
import { getCorsHeaders, handleCors } from '../_shared/cors.ts';
import { getServiceClient, getUserClient } from '../_shared/supabaseClient.ts';
import { normalizeMatric } from '../_shared/crypto.ts';

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
    // 1. Authenticate caller strictly via Supabase Auth
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

    const userClient = getUserClient(authHeader);
    const { data: { user }, error: authErr } = await userClient.auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({
        error: 'UNAUTHORIZED',
        message: 'Invalid or expired auth session token.',
      }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getServiceClient();

    // 2. Resolve caller in users table
    const { data: dbUser, error: dbUserErr } = await supabase
      .from('users')
      .select('id, role, status')
      .or(`auth_id.eq.${user.id},id.eq.${user.id}`)
      .eq('status', 'active')
      .maybeSingle();

    if (dbUserErr || !dbUser) {
      return new Response(JSON.stringify({
        error: 'FORBIDDEN',
        message: 'User account not authorized or inactive.',
      }), {
        status: 403,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Validate body parameters
    const body = await req.json().catch(() => ({}));
    const courseId = body?.course_id;
    const mode = body?.mode === 'replace' ? 'replace' : 'append';
    const rows = Array.isArray(body?.rows) ? body.rows : [];

    if (!courseId || !isValidUuid(courseId)) {
      return new Response(JSON.stringify({
        error: 'BAD_REQUEST',
        message: 'Valid course_id UUID is required.',
      }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Verify course authorization (Admin or owning Lecturer)
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('id, lecturer_id, status, code')
      .eq('id', courseId)
      .maybeSingle();

    if (courseErr || !course) {
      return new Response(JSON.stringify({
        error: 'COURSE_NOT_FOUND',
        message: 'Course not found.',
      }), {
        status: 404,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (dbUser.role !== 'admin' && course.lecturer_id !== dbUser.id) {
      return new Response(JSON.stringify({
        error: 'FORBIDDEN',
        message: 'Lecturers may only manage rosters for their assigned courses.',
      }), {
        status: 403,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({
        accepted: [],
        rejected: [],
      }), {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Extract and normalize all matriculation numbers
    interface ParsedRow {
      rowNumber: number;
      rawMatric: string;
      cleanMatric: string;
    }

    const parsedRows: ParsedRow[] = [];
    const normalizedMatricSet = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawMatric =
        typeof row === 'string'
          ? row
          : (row?.matric_no || row?.matric || row?.['Matric No'] || row?.['Matric Number'] || '');

      const cleanMatric = normalizeMatric(rawMatric);
      parsedRows.push({
        rowNumber: i + 1,
        rawMatric,
        cleanMatric,
      });

      if (cleanMatric) {
        normalizedMatricSet.add(cleanMatric);
      }
    }

    // 6. Bulk query students_master directory by normalized matrics (NEVER insert to students_master)
    const matricArray = Array.from(normalizedMatricSet);
    const studentMap = new Map<string, string>(); // cleanMatric -> student_id

    if (matricArray.length > 0) {
      // Chunk query in batches of 500 to prevent SQL expression overflow
      const chunkSize = 500;
      for (let i = 0; i < matricArray.length; i += chunkSize) {
        const chunk = matricArray.slice(i, i + chunkSize);
        const { data: students, error: studentErr } = await supabase
          .from('students_master')
          .select('id, matric_no')
          .in('matric_no', chunk);

        if (studentErr) {
          console.error('Bulk query students_master failed:', studentErr);
          return new Response(JSON.stringify({
            error: 'DATABASE_ERROR',
            message: 'Failed to query student master directory.',
          }), {
            status: 500,
            headers: { ...baseHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (students) {
          for (const s of students) {
            studentMap.set(s.matric_no, s.id);
          }
        }
      }
    }

    // 7. Validate each row against verified students_master directory
    const acceptedMatrics: string[] = [];
    const rosterInserts: { course_id: string; student_id: string; uploaded_by: string }[] = [];
    const rejected: { row: number; matric?: string; reason: string }[] = [];
    const seenStudentIds = new Set<string>();

    for (const pr of parsedRows) {
      if (!pr.cleanMatric) {
        rejected.push({
          row: pr.rowNumber,
          matric: pr.rawMatric,
          reason: 'Empty or invalid matriculation number format.',
        });
        continue;
      }

      const studentId = studentMap.get(pr.cleanMatric);
      if (!studentId) {
        // Unknown matriculation number: strictly reject, never touch students_master
        rejected.push({
          row: pr.rowNumber,
          matric: pr.rawMatric,
          reason: 'Matriculation number not found in student master directory.',
        });
        continue;
      }

      if (seenStudentIds.has(studentId)) {
        // Duplicate in import payload
        continue;
      }

      seenStudentIds.add(studentId);
      acceptedMatrics.push(pr.cleanMatric);
      rosterInserts.push({
        course_id: courseId,
        student_id: studentId,
        uploaded_by: dbUser.id,
      });
    }

    // 8. If replace mode requested, purge existing roster entries for course
    if (mode === 'replace') {
      const { error: delErr } = await supabase
        .from('course_roster')
        .delete()
        .eq('course_id', courseId);

      if (delErr) {
        console.error('Failed to purge existing course roster in replace mode:', delErr);
        return new Response(JSON.stringify({
          error: 'DATABASE_ERROR',
          message: 'Failed to reset existing course roster.',
        }), {
          status: 500,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 9. Bulk insert accepted students into course_roster
    if (rosterInserts.length > 0) {
      const { error: insertErr } = await supabase
        .from('course_roster')
        .upsert(rosterInserts, { onConflict: 'course_id,student_id', ignoreDuplicates: true });

      if (insertErr) {
        console.error('Failed to insert course roster entries:', insertErr);
        return new Response(JSON.stringify({
          error: 'DATABASE_ERROR',
          message: insertErr.message || 'Failed to enroll accepted students on course roster.',
        }), {
          status: 500,
          headers: { ...baseHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // 10. Audit log
    await supabase.from('audit_logs').insert({
      actor_id: dbUser.id,
      actor_role: dbUser.role,
      action: 'import_course_roster',
      target_table: 'course_roster',
      record_id: courseId,
      metadata: {
        mode,
        accepted_count: acceptedMatrics.length,
        rejected_count: rejected.length,
      },
    });

    // 11. Return contract shape matching Agent 3 requirements
    return new Response(JSON.stringify({
      accepted: acceptedMatrics,
      rejected: rejected,
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
