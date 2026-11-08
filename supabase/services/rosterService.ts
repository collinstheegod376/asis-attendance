/**
 * ADUN Attendance - Course Roster & Student Import Service
 * Handles master student directory lookups, course roster upload verification,
 * deduplication, rejection reporting, and append vs replace roster management.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';
import { normalizeMatric } from '../functions/_shared/crypto.ts';

export interface RosterUploadRow {
  matric_no: string;
  surname?: string;
  first_name?: string;
  program?: string;
  level?: number | string;
}

export interface RosterImportSummary {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: Array<{
    rowNumber: number;
    matric_no: string;
    reason: string;
  }>;
  mode: 'append' | 'replace';
}

export class RosterService {
  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Processes a lecturer-uploaded course roster spreadsheet
   */
  async processRosterUpload(params: {
    courseId: string;
    lecturerId: string;
    rows: RosterUploadRow[];
    mode: 'append' | 'replace';
  }): Promise<RosterImportSummary> {
    const { courseId, lecturerId, rows, mode } = params;

    // Verify course exists and belongs to lecturer
    const { data: course, error: courseErr } = await this.supabase
      .from('courses')
      .select('id, code, title, lecturer_id, status')
      .eq('id', courseId)
      .single();

    if (courseErr || !course) {
      throw new Error('Course not found.');
    }

    if (course.lecturer_id !== lecturerId) {
      throw new Error('Unauthorized: Course does not belong to this lecturer.');
    }

    if (course.status === 'archived') {
      throw new Error('Cannot update roster for an archived course.');
    }

    const acceptedStudents: Array<{ id: string; matric_no: string }> = [];
    const rejectedRows: Array<{ rowNumber: number; matric_no: string; reason: string }> = [];
    const seenMatrics = new Set<string>();

    // 1. Validate rows and match against students_master
    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const rawMatric = rows[i].matric_no;

      if (!rawMatric || !rawMatric.trim()) {
        rejectedRows.push({ rowNumber: rowNum, matric_no: '', reason: 'Missing matric number' });
        continue;
      }

      const cleanMatric = normalizeMatric(rawMatric);

      if (seenMatrics.has(cleanMatric)) {
        rejectedRows.push({
          rowNumber: rowNum,
          matric_no: cleanMatric,
          reason: 'Duplicate matric number in upload file',
        });
        continue;
      }
      seenMatrics.add(cleanMatric);

      // Search student in master table
      const { data: student, error: studentErr } = await this.supabase
        .from('students_master')
        .select('id, matric_no, status')
        .eq('matric_no', cleanMatric)
        .single();

      if (studentErr || !student) {
        rejectedRows.push({
          rowNumber: rowNum,
          matric_no: cleanMatric,
          reason: 'Student not found in institutional master directory',
        });
        continue;
      }

      if (student.status !== 'active') {
        rejectedRows.push({
          rowNumber: rowNum,
          matric_no: cleanMatric,
          reason: `Student status is ${student.status} (inactive)`,
        });
        continue;
      }

      acceptedStudents.push({ id: student.id, matric_no: student.matric_no });
    }

    // 2. Apply Mode: If 'replace', clear existing roster first
    if (mode === 'replace') {
      const { error: deleteErr } = await this.supabase
        .from('course_roster')
        .delete()
        .eq('course_id', courseId);

      if (deleteErr) {
        throw new Error(`Failed to clear previous roster: ${deleteErr.message}`);
      }
    }

    // 3. Insert accepted students into course_roster with ON CONFLICT DO NOTHING
    if (acceptedStudents.length > 0) {
      const rosterEntries = acceptedStudents.map((st) => ({
        course_id: courseId,
        student_id: st.id,
        uploaded_by: lecturerId,
      }));

      const { error: insertErr } = await this.supabase
        .from('course_roster')
        .upsert(rosterEntries, { onConflict: 'course_id,student_id' });

      if (insertErr) {
        throw new Error(`Failed to save roster: ${insertErr.message}`);
      }
    }

    // 4. Log to Audit Trail
    await this.supabase.from('audit_logs').insert({
      actor_id: lecturerId,
      actor_role: 'lecturer',
      action: 'ROSTER_UPLOADED',
      entity: 'course_roster',
      entity_id: courseId,
      metadata: {
        totalRows: rows.length,
        acceptedCount: acceptedStudents.length,
        rejectedCount: rejectedRows.length,
        mode,
      },
    });

    return {
      totalRows: rows.length,
      acceptedRows: acceptedStudents.length,
      rejectedRows,
      mode,
    };
  }

  /**
   * Retrieves full enrolled student roster for a course
   */
  async getCourseRoster(courseId: string) {
    const { data, error } = await this.supabase
      .from('course_roster')
      .select(`
        id,
        uploaded_at,
        students_master:student_id (
          id,
          matric_no,
          surname,
          first_name,
          middle_name,
          program,
          level,
          email,
          phone,
          status
        )
      `)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to fetch course roster: ${error.message}`);
    }

    return data;
  }
}
