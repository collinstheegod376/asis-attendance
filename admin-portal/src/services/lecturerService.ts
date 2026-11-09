/**
 * ADUN Attendance System - Direct Supabase Lecturer Service
 * Replaces localStorage storage.ts mock with direct Supabase table queries and RLS.
 * Fixes: SEC-17, QA-02, QA-12, QA-16, QA-17, QA-20, QA-22, PERF-09, PERF-10, PERF-16
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  Course,
  CourseRoster,
  LectureSession,
  AttendanceRecord,
  StudentMaster,
  DeviceBinding,
  SessionStatus,
} from '../types';
import { sanitizeErrorMessage } from '../lib/errorHandler';
import { ExportService } from './exportService';
import { RosterService } from './rosterService';
import { callEdgeFunction } from './apiClient';
import { formatWATDate, formatWATTime } from '../lib/dateUtils';

// SHA-256 helper for session tokens
async function sha256Hex(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate high-entropy 48-char hex token
function generateHighEntropyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export interface StudentAttendanceSummary {
  student_id: string;
  matric_no: string;
  student_name: string;
  program: string;
  level: string;
  total_sessions: number;
  attended_sessions: number;
  attendance_percentage: number;
  last_signed_date: string | null;
  last_signed_time: string | null;
  last_status: 'present' | 'late' | null;
}

export interface StudentCalendarSessionDetail {
  session_id: string;
  session_title: string;
  session_date: string;
  starts_at: string;
  status: 'present' | 'late' | 'absent';
  signed_at: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  selfie_url: string | null;
  selfie_path: string | null;
  verification_status: 'passed' | 'manual_review' | null;
  receipt_id: string | null;
  proxy_risk?: 'low' | 'medium' | 'high';
  fingerprint_snapshot_ref?: string;
  device_id?: string;
}

export class LecturerService {
  // ================= COURSES & 9-COURSE LIMIT =================

  static async getLecturerCourses(lecturerId: string): Promise<{
    activeCourses: Course[];
    archivedCourses: Course[];
    activeCount: number;
    maxQuota: number;
    canCreateCourse: boolean;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { activeCourses: [], archivedCourses: [], activeCount: 0, maxQuota: 9, canCreateCourse: true };
    }

    try {
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .eq('lecturer_id', lecturerId)
        .order('created_at', { ascending: false });

      if (error || !courses) {
        console.error('Failed to get lecturer courses:', error);
        return { activeCourses: [], archivedCourses: [], activeCount: 0, maxQuota: 9, canCreateCourse: true };
      }

      // Fetch settings for max_active_courses_per_lecturer
      const { data: settings } = await supabase
        .from('settings')
        .select('max_active_courses_per_lecturer')
        .limit(1)
        .maybeSingle();

      const maxQuota = settings?.max_active_courses_per_lecturer || 9;

      const courseIds = courses.map((c: any) => c.id);

      // Fetch enrolled count and sessions count per course
      const rosterCountMap = new Map<string, number>();
      const sessionsCountMap = new Map<string, number>();

      if (courseIds.length > 0) {
        const [rostersRes, sessionsRes] = await Promise.all([
          supabase
            .from('course_roster')
            .select('course_id')
            .in('course_id', courseIds),
          supabase
            .from('lecture_sessions')
            .select('course_id')
            .in('course_id', courseIds),
        ]);

        (rostersRes.data || []).forEach((r: any) => {
          rosterCountMap.set(r.course_id, (rosterCountMap.get(r.course_id) || 0) + 1);
        });

        (sessionsRes.data || []).forEach((s: any) => {
          sessionsCountMap.set(s.course_id, (sessionsCountMap.get(s.course_id) || 0) + 1);
        });
      }

      const activeCourses: Course[] = [];
      const archivedCourses: Course[] = [];

      for (const c of courses) {
        const mapped: Course = {
          id: c.id,
          code: c.code,
          title: c.title,
          lecturer_id: c.lecturer_id,
          status: c.status,
          created_at: c.created_at,
          enrolled_count: rosterCountMap.get(c.id) || 0,
          sessions_count: sessionsCountMap.get(c.id) || 0,
        };
        if (c.status === 'active') activeCourses.push(mapped);
        else archivedCourses.push(mapped);
      }

      const activeCount = activeCourses.length;

      return {
        activeCourses,
        archivedCourses,
        activeCount,
        maxQuota,
        canCreateCourse: activeCount < maxQuota,
      };
    } catch (e) {
      console.error('getLecturerCourses exception:', e);
      return { activeCourses: [], archivedCourses: [], activeCount: 0, maxQuota: 9, canCreateCourse: true };
    }
  }

  static async getCourseById(courseId: string): Promise<Course | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const { data, error } = await supabase
        .from('courses')
        .select('*')
        .eq('id', courseId)
        .maybeSingle();

      if (error || !data) return null;

      // Query enrolled_count and sessions_count
      const [rosterRes, sessionsRes] = await Promise.all([
        supabase
          .from('course_roster')
          .select('id', { count: 'exact', head: true })
          .eq('course_id', courseId),
        supabase
          .from('lecture_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('course_id', courseId),
      ]);

      return {
        id: data.id,
        code: data.code,
        title: data.title,
        lecturer_id: data.lecturer_id,
        status: data.status,
        created_at: data.created_at,
        enrolled_count: rosterRes.count || 0,
        sessions_count: sessionsRes.count || 0,
      };
    } catch (e) {
      console.error('getCourseById exception:', e);
      return null;
    }
  }

  static async createCourse(
    lecturerId: string,
    data: { code: string; title: string; department?: string },
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string; course?: Course }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const quotaCheck = await this.getLecturerCourses(lecturerId);
      if (!quotaCheck.canCreateCourse) {
        return {
          success: false,
          error: `Active course limit reached (${quotaCheck.activeCount}/${quotaCheck.maxQuota}). You must archive an existing course to create a new one.`,
        };
      }

      const codeClean = data.code.trim().toUpperCase();

      const { data: inserted, error } = await supabase
        .from('courses')
        .insert({
          code: codeClean,
          title: data.title.trim(),
          lecturer_id: lecturerId,
          status: 'active',
        })
        .select()
        .single();

      if (error || !inserted) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'CREATE_COURSE',
        entity: 'courses',
        entity_id: inserted.id,
        metadata: { code: inserted.code, title: inserted.title },
      });

      return {
        success: true,
        course: {
          id: inserted.id,
          code: inserted.code,
          title: inserted.title,
          lecturer_id: inserted.lecturer_id,
          status: inserted.status,
          created_at: inserted.created_at,
        },
      };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async archiveCourse(
    courseId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      // 1. Verify ownership and existence
      const course = await this.getCourseById(courseId);
      if (!course) return { success: false, error: 'Course not found.' };

      // 2. Archive course
      const { error: archErr } = await supabase
        .from('courses')
        .update({ status: 'archived' })
        .eq('id', courseId);

      if (archErr) return { success: false, error: sanitizeErrorMessage(archErr) };

      // 3. Close active and scheduled lecture sessions
      await supabase
        .from('lecture_sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('course_id', courseId)
        .in('status', ['active', 'scheduled']);

      // 4. Audit log
      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'ARCHIVE_COURSE',
        entity: 'courses',
        entity_id: courseId,
        metadata: { courseCode: course.code },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async unarchiveCourse(
    courseId: string,
    lecturerId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const quotaCheck = await this.getLecturerCourses(lecturerId);
      if (quotaCheck.activeCount >= quotaCheck.maxQuota) {
        return {
          success: false,
          error: `Cannot unarchive course. You already have ${quotaCheck.activeCount} active courses (Maximum: ${quotaCheck.maxQuota}). Archive another course first.`,
        };
      }

      const { error } = await supabase
        .from('courses')
        .update({ status: 'active' })
        .eq('id', courseId);

      if (error) return { success: false, error: sanitizeErrorMessage(error) };

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'UNARCHIVE_COURSE',
        entity: 'courses',
        entity_id: courseId,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= SESSIONS & TOKENS =================

  static async getCourseSessions(courseId: string): Promise<LectureSession[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data: sessions, error } = await supabase
        .from('lecture_sessions')
        .select('*')
        .eq('course_id', courseId)
        .order('starts_at', { ascending: false });

      if (error || !sessions) {
        console.error('Failed to get course sessions:', error);
        return [];
      }

      // Query attendance counts for these sessions
      const sessionIds = sessions.map((s: any) => s.id);
      const countMap = new Map<string, number>();

      if (sessionIds.length > 0) {
        const { data: records } = await supabase
          .from('attendance_records')
          .select('session_id')
          .in('session_id', sessionIds);

        (records || []).forEach((r: any) => {
          countMap.set(r.session_id, (countMap.get(r.session_id) || 0) + 1);
        });
      }

      return sessions.map((s: any) => {
        // Read raw token from local storage cache if available
        let rawToken: string | undefined = undefined;
        try {
          rawToken = localStorage.getItem(`adun_session_token_${s.id}`) || undefined;
        } catch {}

        return {
          id: s.id,
          course_id: s.course_id,
          title: s.title,
          token_hash: s.token_hash,
          raw_token: rawToken,
          starts_at: s.starts_at,
          expires_at: s.expires_at,
          duration_minutes: Math.round(
            (new Date(s.expires_at).getTime() - new Date(s.starts_at).getTime()) / (60 * 1000)
          ),
          grace_minutes: s.grace_minutes,
          status: s.status,
          created_by: s.created_by,
          created_at: s.created_at,
          closed_at: s.closed_at,
          attendance_count: countMap.get(s.id) || 0,
        };
      });
    } catch (e) {
      console.error('getCourseSessions exception:', e);
      return [];
    }
  }

  static async getLecturerRecentSessions(lecturerId: string, limit = 6): Promise<LectureSession[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data: courses } = await supabase
        .from('courses')
        .select('id')
        .eq('lecturer_id', lecturerId);

      const courseIds = (courses || []).map((c: any) => c.id);
      if (courseIds.length === 0) return [];

      const { data: sessions, error } = await supabase
        .from('lecture_sessions')
        .select('*')
        .in('course_id', courseIds)
        .order('starts_at', { ascending: false })
        .limit(limit);

      if (error || !sessions) return [];

      const sessionIds = sessions.map((s: any) => s.id);
      const { data: records } = await supabase
        .from('attendance_records')
        .select('session_id')
        .in('session_id', sessionIds);

      const countMap = new Map<string, number>();
      (records || []).forEach((r: any) => {
        countMap.set(r.session_id, (countMap.get(r.session_id) || 0) + 1);
      });

      return sessions.map((s: any) => ({
        id: s.id,
        course_id: s.course_id,
        title: s.title,
        token_hash: s.token_hash,
        raw_token: undefined,
        starts_at: s.starts_at,
        expires_at: s.expires_at,
        duration_minutes: Math.round(
          (new Date(s.expires_at).getTime() - new Date(s.starts_at).getTime()) / (60 * 1000)
        ),
        grace_minutes: s.grace_minutes,
        status: s.status,
        created_by: s.created_by,
        created_at: s.created_at,
        closed_at: s.closed_at,
        attendance_count: countMap.get(s.id) || 0,
      }));
    } catch (e) {
      console.error('getLecturerRecentSessions exception:', e);
      return [];
    }
  }

  static async getSessionById(sessionId: string): Promise<LectureSession | null> {
    if (!isSupabaseConfigured || !supabase) return null;

    try {
      const { data: s, error } = await supabase
        .from('lecture_sessions')
        .select('*, courses(code, title, lecturer_id)')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !s) return null;

      let rawToken: string | undefined = undefined;
      try {
        rawToken = localStorage.getItem(`adun_session_token_${s.id}`) || undefined;
      } catch {}

      return {
        id: s.id,
        course_id: s.course_id,
        course_code: s.courses?.code,
        course_title: s.courses?.title,
        lecturer_id: s.courses?.lecturer_id,
        title: s.title,
        token_hash: s.token_hash,
        raw_token: rawToken,
        starts_at: s.starts_at,
        expires_at: s.expires_at,
        duration_minutes: Math.round(
          (new Date(s.expires_at).getTime() - new Date(s.starts_at).getTime()) / (60 * 1000)
        ),
        grace_minutes: s.grace_minutes,
        status: s.status,
        created_by: s.created_by,
        created_at: s.created_at,
        closed_at: s.closed_at,
      };
    } catch (e) {
      console.error('getSessionById exception:', e);
      return null;
    }
  }

  static async createLectureSession(
    courseId: string,
    data: {
      title: string;
      starts_at: string;
      duration_minutes: number;
      grace_minutes?: number;
    },
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string; session?: LectureSession; rawToken?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      // 1. Verify course existence and ownership
      const course = await this.getCourseById(courseId);
      if (!course) return { success: false, error: 'Course not found.' };

      // 2. Fetch max allowed duration from settings
      const { data: settings } = await supabase
        .from('settings')
        .select('max_session_duration_minutes, default_session_duration_minutes, grace_minutes')
        .limit(1)
        .maybeSingle();

      const maxDuration = settings?.max_session_duration_minutes || 180;
      const defaultGrace = settings?.grace_minutes || 10;

      // Fix QA-22: Reject (never clamp) if duration > max duration
      if (data.duration_minutes > maxDuration) {
        return {
          success: false,
          error: `Duration of ${data.duration_minutes} minutes exceeds the maximum allowed duration of ${maxDuration} minutes. Please enter a valid duration.`,
        };
      }

      if (data.duration_minutes <= 0) {
        return {
          success: false,
          error: 'Session duration must be greater than 0 minutes.',
        };
      }

      const duration = data.duration_minutes;
      const graceMinutes = data.grace_minutes !== undefined ? data.grace_minutes : defaultGrace;

      const startsAtDate = new Date(data.starts_at);
      const expiresAtDate = new Date(startsAtDate.getTime() + duration * 60 * 1000);

      // Fix QA-17: Compute status from starts_at: 'scheduled' if in the future, else 'active'
      const now = new Date();
      const status: SessionStatus = startsAtDate.getTime() > now.getTime() ? 'scheduled' : 'active';

      // High entropy raw token (pre-image) and token hash
      const rawToken = generateHighEntropyToken();
      const tokenHash = await sha256Hex(rawToken);

      const { data: inserted, error: insertErr } = await supabase
        .from('lecture_sessions')
        .insert({
          course_id: courseId,
          title: data.title.trim(),
          token_hash: tokenHash,
          starts_at: startsAtDate.toISOString(),
          expires_at: expiresAtDate.toISOString(),
          grace_minutes: graceMinutes,
          status,
          created_by: actor.id,
        })
        .select()
        .single();

      if (insertErr || !inserted) {
        return { success: false, error: sanitizeErrorMessage(insertErr) };
      }

      // Store raw token in local storage cache for projector view display
      try {
        localStorage.setItem(`adun_session_token_${inserted.id}`, rawToken);
      } catch {}

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'CREATE_LECTURE_SESSION',
        entity: 'lecture_sessions',
        entity_id: inserted.id,
        metadata: {
          courseCode: course.code,
          sessionTitle: inserted.title,
          status,
          starts_at: inserted.starts_at,
          expires_at: inserted.expires_at,
        },
      });

      const newSession: LectureSession = {
        id: inserted.id,
        course_id: inserted.course_id,
        course_code: course.code,
        course_title: course.title,
        title: inserted.title,
        token_hash: inserted.token_hash,
        raw_token: rawToken,
        starts_at: inserted.starts_at,
        expires_at: inserted.expires_at,
        duration_minutes: duration,
        grace_minutes: inserted.grace_minutes,
        status: inserted.status,
        created_by: inserted.created_by,
        created_at: inserted.created_at,
        closed_at: inserted.closed_at,
        attendance_count: 0,
      };

      return {
        success: true,
        session: newSession,
        rawToken,
      };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async startScheduledSessionNow(
    sessionId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const session = await this.getSessionById(sessionId);
      if (!session) return { success: false, error: 'Session not found.' };

      const now = new Date();
      const expiresAt = new Date(now.getTime() + session.duration_minutes * 60 * 1000);

      const { error } = await supabase
        .from('lecture_sessions')
        .update({
          starts_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          status: 'active',
        })
        .eq('id', sessionId);

      if (error) return { success: false, error: sanitizeErrorMessage(error) };

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'START_SCHEDULED_SESSION_NOW',
        entity: 'lecture_sessions',
        entity_id: sessionId,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async closeLectureSession(
    sessionId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('lecture_sessions')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (error) return { success: false, error: sanitizeErrorMessage(error) };

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'CLOSE_LECTURE_SESSION',
        entity: 'lecture_sessions',
        entity_id: sessionId,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // Fix QA-17: New revoke lecture session action
  static async revokeLectureSession(
    sessionId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('lecture_sessions')
        .update({
          status: 'revoked',
          closed_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (error) return { success: false, error: sanitizeErrorMessage(error) };

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'REVOKE_LECTURE_SESSION',
        entity: 'lecture_sessions',
        entity_id: sessionId,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= ROSTER =================

  static async getCourseRoster(courseId: string): Promise<CourseRoster[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('course_roster')
        .select('*, students_master(matric_no, surname, first_name, middle_name, program, level)')
        .eq('course_id', courseId);

      if (error || !data) {
        console.error('Failed to get course roster:', error);
        return [];
      }

      return data.map((r: any) => {
        const s = r.students_master;
        const studentName = s
          ? `${s.surname} ${s.first_name} ${s.middle_name || ''}`.trim()
          : 'Enrolled Student';

        return {
          id: r.id,
          course_id: r.course_id,
          student_id: r.student_id,
          matric_no: s?.matric_no || 'N/A',
          student_name: studentName,
          program: s?.program || 'N/A',
          level: String(s?.level || '100'),
          uploaded_by: r.uploaded_by,
          uploaded_at: r.uploaded_at,
        };
      });
    } catch (e) {
      console.error('getCourseRoster exception:', e);
      return [];
    }
  }

  static async removeStudentFromRoster(
    rosterId: string,
    actor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database client unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('course_roster')
        .delete()
        .eq('id', rosterId);

      if (error) return { success: false, error: sanitizeErrorMessage(error) };

      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        actor_role: 'lecturer',
        action: 'REMOVE_STUDENT_FROM_ROSTER',
        entity: 'course_roster',
        entity_id: rosterId,
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async importCourseRoster(
    courseId: string,
    rawRows: any[],
    mode: 'append' | 'replace'
  ) {
    return RosterService.importCourseRoster(courseId, rawRows, mode);
  }

  // ================= ATTENDANCE RECORDS & SUMMARY =================

  static async getCourseAttendanceRecords(courseId: string): Promise<AttendanceRecord[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*, students_master(matric_no, surname, first_name, middle_name, program, level)')
        .eq('course_id', courseId)
        .order('signed_at', { ascending: false });

      if (error || !data) {
        console.error('Failed to get attendance records:', error);
        return [];
      }

      return data.map((r: any) => {
        const s = r.students_master;
        const studentName = s
          ? `${s.surname} ${s.first_name} ${s.middle_name || ''}`.trim()
          : 'Enrolled Student';

        return {
          id: r.id,
          session_id: r.session_id,
          course_id: r.course_id,
          student_id: r.student_id,
          matric_no: s?.matric_no || '',
          student_name: studentName,
          program: s?.program,
          level: String(s?.level || '100'),
          signed_at: r.signed_at,
          status: r.status,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy_m: r.accuracy_m,
          selfie_path: r.selfie_path,
          verification_status: r.verification_status,
          device_info: r.device_info ? JSON.stringify(r.device_info) : undefined,
          receipt_id: r.receipt_id,
          proxy_risk: r.proxy_risk,
        };
      });
    } catch (e) {
      console.error('getCourseAttendanceRecords exception:', e);
      return [];
    }
  }

  static async getSessionAttendanceRecords(sessionId: string): Promise<AttendanceRecord[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*, students_master(matric_no, surname, first_name, middle_name)')
        .eq('session_id', sessionId)
        .order('signed_at', { ascending: false });

      if (error || !data) return [];

      return data.map((r: any) => {
        const s = r.students_master;
        const studentName = s
          ? `${s.surname} ${s.first_name} ${s.middle_name || ''}`.trim()
          : 'Enrolled Student';

        return {
          id: r.id,
          session_id: r.session_id,
          course_id: r.course_id,
          student_id: r.student_id,
          matric_no: s?.matric_no || '',
          student_name: studentName,
          signed_at: r.signed_at,
          status: r.status,
          latitude: r.latitude,
          longitude: r.longitude,
          accuracy_m: r.accuracy_m,
          selfie_path: r.selfie_path,
          verification_status: r.verification_status,
          receipt_id: r.receipt_id,
          proxy_risk: r.proxy_risk,
        };
      });
    } catch (e) {
      console.error('getSessionAttendanceRecords exception:', e);
      return [];
    }
  }

  static async getCourseAttendanceSummary(courseId: string): Promise<StudentAttendanceSummary[]> {
    const [roster, sessions, attendanceRecords] = await Promise.all([
      this.getCourseRoster(courseId),
      this.getCourseSessions(courseId),
      this.getCourseAttendanceRecords(courseId),
    ]);

    const totalSessionsHeld = sessions.length;

    return roster.map(student => {
      const studentRecords = attendanceRecords
        .filter(r => r.student_id === student.student_id)
        .sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime());

      const attendedSessions = studentRecords.length;

      // Fix QA-16 / PERF-09: If 0 sessions held, percentage is 0% (NOT 100%, NOT N/A!)
      const attendancePercentage =
        totalSessionsHeld > 0 ? Math.round((attendedSessions / totalSessionsHeld) * 100) : 0;

      const lastRecord = studentRecords[0] || null;

      let lastDate: string | null = null;
      let lastTime: string | null = null;
      if (lastRecord) {
        lastDate = formatWATDate(lastRecord.signed_at);
        lastTime = formatWATTime(lastRecord.signed_at);
      }

      return {
        student_id: student.student_id,
        matric_no: student.matric_no,
        student_name: student.student_name,
        program: student.program || 'N/A',
        level: student.level || '100',
        total_sessions: totalSessionsHeld,
        attended_sessions: attendedSessions,
        attendance_percentage: attendancePercentage,
        last_signed_date: lastDate,
        last_signed_time: lastTime,
        last_status: lastRecord ? lastRecord.status : null,
      };
    });
  }

  static async getStudentCalendarDetails(
    courseId: string,
    studentId: string
  ): Promise<{
    student: StudentMaster | undefined;
    sessions: StudentCalendarSessionDetail[];
    overallPercentage: number;
    attendedCount: number;
    totalSessions: number;
    deviceBinding: DeviceBinding | null;
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return {
        student: undefined,
        sessions: [],
        overallPercentage: 0,
        attendedCount: 0,
        totalSessions: 0,
        deviceBinding: null,
      };
    }

    const [studentRes, sessions, recordsRes, bindingRes] = await Promise.all([
      supabase.from('students_master').select('*').eq('id', studentId).maybeSingle(),
      this.getCourseSessions(courseId),
      supabase
        .from('attendance_records')
        .select('*')
        .eq('course_id', courseId)
        .eq('student_id', studentId),
      supabase
        .from('device_bindings')
        .select('*')
        .eq('student_id', studentId)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const studentData = studentRes.data;
    const student: StudentMaster | undefined = studentData
      ? {
          id: studentData.id,
          matric_no: studentData.matric_no,
          search_key: studentData.search_key || '',
          surname: studentData.surname,
          first_name: studentData.first_name,
          middle_name: studentData.middle_name || undefined,
          program: studentData.program,
          level: String(studentData.level || '100'),
          status: studentData.status || 'active',
          created_at: studentData.created_at,
        }
      : undefined;

    const studentRecords = recordsRes.data || [];

    const sessionDetails: StudentCalendarSessionDetail[] = sessions.map(session => {
      const record = studentRecords.find((r: any) => r.session_id === session.id);
      const sessionDateStr = formatWATDate(session.starts_at);

      if (record) {
        return {
          session_id: session.id,
          session_title: session.title,
          session_date: sessionDateStr,
          starts_at: session.starts_at,
          status: record.status,
          signed_at: record.signed_at,
          latitude: record.latitude ?? null,
          longitude: record.longitude ?? null,
          accuracy_m: record.accuracy_m ?? null,
          selfie_url: null,
          selfie_path: record.selfie_path || null,
          verification_status: record.verification_status,
          receipt_id: record.receipt_id,
          proxy_risk: record.proxy_risk || 'low',
        };
      } else {
        return {
          session_id: session.id,
          session_title: session.title,
          session_date: sessionDateStr,
          starts_at: session.starts_at,
          status: 'absent',
          signed_at: null,
          latitude: null,
          longitude: null,
          accuracy_m: null,
          selfie_url: null,
          selfie_path: null,
          verification_status: null,
          receipt_id: null,
        };
      }
    });

    const attendedCount = studentRecords.length;
    const totalSessions = sessions.length;
    // Fix QA-16 / PERF-09: 0 sessions = 0%
    const overallPercentage = totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 0;

    let deviceBinding: DeviceBinding | null = null;
    if (bindingRes.data) {
      const b = bindingRes.data;
      deviceBinding = {
        id: b.id,
        device_id: b.device_id || b.id,
        device_fingerprint_hash: b.fingerprint_hash,
        student_id: b.student_id,
        matric_no: student?.matric_no || '',
        student_name: student ? `${student.surname} ${student.first_name}` : '',
        matric_hash: b.fingerprint_hash || '',
        user_agent: b.user_agent,
        first_bound_at: b.first_bound_at,
        last_seen_at: b.last_seen_at,
        status: b.status,
        is_shared: Boolean(b.is_shared),
      };
    }

    return {
      student,
      sessions: sessionDetails,
      overallPercentage,
      attendedCount,
      totalSessions,
      deviceBinding,
    };
  }

  // ================= EXCEL EXPORT =================

  static async exportTwoSheetExcel(courseId: string): Promise<void> {
    const course = await this.getCourseById(courseId);
    if (!course) throw new Error('Course not found');

    const [roster, sessions, records, studentsRes] = await Promise.all([
      this.getCourseRoster(courseId),
      this.getCourseSessions(courseId),
      this.getCourseAttendanceRecords(courseId),
      supabase?.from('students_master').select('*'),
    ]);

    const studentsMaster: StudentMaster[] = (studentsRes?.data || []).map((s: any) => ({
      id: s.id,
      matric_no: s.matric_no,
      search_key: s.search_key || '',
      surname: s.surname,
      first_name: s.first_name,
      middle_name: s.middle_name || undefined,
      program: s.program,
      level: String(s.level || '100'),
      status: s.status || 'active',
      created_at: s.created_at,
    }));

    await ExportService.exportCourseAttendanceReport(
      course,
      roster,
      sessions,
      records,
      studentsMaster
    );
  }

  // ================= DEVICE RESET =================

  static async emergencyResetDevice(
    studentId: string,
    courseId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!reason || reason.trim().length < 10) {
      return {
        success: false,
        error: 'A detailed forensic reason (minimum 10 characters) is required to reset a device binding.',
      };
    }

    const result = await callEdgeFunction('reset-device-binding', {
      student_id: studentId,
      reason: reason.trim(),
    });

    if (!result.success) {
      return {
        success: false,
        error: sanitizeErrorMessage(result.error, 'Failed to reset device lock.'),
      };
    }

    return { success: true };
  }

  static async getSelfieSignedUrl(selfiePath: string): Promise<string> {
    return ExportService.getSignedSelfieUrl(selfiePath);
  }
}
