/**
 * ADUN Attendance System - Direct Supabase Admin Service
 * Queries Supabase tables directly with granular RLS.
 * Replaces localStorage-based persistence and eliminates the 3s sync loop.
 * Fixes: QA-02, QA-03, QA-18, PERF-03
 */

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import {
  User,
  Course,
  StudentMaster,
  SystemSettings,
  DeviceBinding,
  DeviceEvent,
  AuditLog,
} from '../types';
import { sanitizeErrorMessage } from '../lib/errorHandler';
import { callEdgeFunction } from './apiClient';

export class AdminService {
  // ================= USERS / LECTURERS =================

  static async getLecturers(): Promise<User[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('role', 'lecturer')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch lecturers:', error);
        return [];
      }

      return (data || []).map((u: any) => ({
        id: u.id,
        role: u.role,
        username: u.username,
        email: u.email,
        name: u.name || (u.username === 'tega' ? 'Mr Tega' : u.username),
        department: u.department || 'Computer Science',
        staff_id: u.staff_id || `ADUN/LEC/${u.id.slice(0, 4)}`,
        status: u.status,
        must_change_password: Boolean(u.must_change_password),
        created_at: u.created_at,
        deleted_at: u.deleted_at,
      }));
    } catch (e) {
      console.error('getLecturers exception:', e);
      return [];
    }
  }

  static async createLecturer(
    lecturer: {
      name: string;
      email: string;
      username: string;
      password?: string;
      department?: string;
      staff_id?: string;
    },
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string; user?: User }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const cleanUsername = lecturer.username.trim().toLowerCase();
      const cleanEmail = lecturer.email.trim().toLowerCase();

      // Check existing in public.users
      const { data: existing } = await supabase
        .from('users')
        .select('id, username, email')
        .or(`username.eq.${cleanUsername},email.eq.${cleanEmail}`)
        .maybeSingle();

      if (existing) {
        return {
          success: false,
          error: 'A user with this username or email already exists.',
        };
      }

      // 1. Create user in Supabase Auth using a non-persistent client
      // to avoid replacing the admin's active session!
      const initialPassword = lecturer.password || 'admin';
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
      const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

      const { createClient } = await import('@supabase/supabase-js');
      const tempAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: signUpData, error: signUpErr } = await tempAuthClient.auth.signUp({
        email: cleanEmail,
        password: initialPassword,
      });

      const authId = signUpData?.user?.id || null;

      // 2. Insert into public.users using admin client
      const insertPayload: any = {
        role: 'lecturer',
        username: cleanUsername,
        email: cleanEmail,
        password_hash: 'managed_by_supabase_auth',
        status: 'active',
        must_change_password: true,
      };

      if (authId) {
        insertPayload.id = authId;
        insertPayload.auth_id = authId;
      }

      const { data: insertedUser, error: insertErr } = await supabase
        .from('users')
        .insert(insertPayload)
        .select()
        .single();

      if (insertErr || !insertedUser) {
        return {
          success: false,
          error: sanitizeErrorMessage(insertErr, 'Failed to create lecturer profile.'),
        };
      }

      // 3. Log audit event
      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: 'CREATE_LECTURER',
        entity: 'users',
        entity_id: insertedUser.id,
        metadata: {
          username: cleanUsername,
          email: cleanEmail,
          department: lecturer.department,
        },
      });

      const newUser: User = {
        id: insertedUser.id,
        role: insertedUser.role,
        username: insertedUser.username,
        email: insertedUser.email,
        name: lecturer.name,
        department: lecturer.department || 'Computer Science',
        staff_id: lecturer.staff_id || `ADUN/LEC/${insertedUser.id.slice(0, 4)}`,
        status: insertedUser.status,
        must_change_password: true,
        created_at: insertedUser.created_at,
      };

      return { success: true, user: newUser };
    } catch (err) {
      return {
        success: false,
        error: sanitizeErrorMessage(err, 'Failed to create lecturer.'),
      };
    }
  }

  static async softDeleteLecturer(
    lecturerId: string,
    actionOnCourses: 'archive' | 'reassign',
    targetLecturerId?: string,
    adminActor?: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      // 1. Fetch lecturer's active courses
      const { data: activeCourses, error: courseFetchErr } = await supabase
        .from('courses')
        .select('id, code, title')
        .eq('lecturer_id', lecturerId)
        .eq('status', 'active');

      if (courseFetchErr) {
        return { success: false, error: sanitizeErrorMessage(courseFetchErr) };
      }

      const activeCourseIds = (activeCourses || []).map(c => c.id);

      if (actionOnCourses === 'reassign') {
        if (!targetLecturerId) {
          return { success: false, error: 'Please select a target lecturer for course reassignment.' };
        }

        // Verify target lecturer active quota
        const { count: targetActiveCount, error: countErr } = await supabase
          .from('courses')
          .select('id', { count: 'exact', head: true })
          .eq('lecturer_id', targetLecturerId)
          .eq('status', 'active');

        if (countErr) {
          return { success: false, error: sanitizeErrorMessage(countErr) };
        }

        const settings = await this.getSettings();
        const maxQuota = settings.max_active_courses_per_lecturer || 9;

        if ((targetActiveCount || 0) + activeCourseIds.length > maxQuota) {
          return {
            success: false,
            error: `Target lecturer already holds ${targetActiveCount} active courses. Reassigning ${activeCourseIds.length} course(s) would exceed the maximum limit of ${maxQuota}.`,
          };
        }

        // Reassign active courses
        if (activeCourseIds.length > 0) {
          const { error: reassignErr } = await supabase
            .from('courses')
            .update({ lecturer_id: targetLecturerId })
            .in('id', activeCourseIds);

          if (reassignErr) {
            return { success: false, error: sanitizeErrorMessage(reassignErr) };
          }
        }
      } else {
        // Archive all active courses and close their active/scheduled sessions
        if (activeCourseIds.length > 0) {
          // Archive courses
          const { error: archErr } = await supabase
            .from('courses')
            .update({ status: 'archived' })
            .in('id', activeCourseIds);

          if (archErr) {
            return { success: false, error: sanitizeErrorMessage(archErr) };
          }

          // Close active and scheduled sessions
          await supabase
            .from('lecture_sessions')
            .update({ status: 'closed', closed_at: new Date().toISOString() })
            .in('course_id', activeCourseIds)
            .in('status', ['active', 'scheduled']);
        }
      }

      // 2. Soft-delete the lecturer profile
      const { error: deleteErr } = await supabase
        .from('users')
        .update({
          status: 'soft_deleted',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', lecturerId);

      if (deleteErr) {
        return { success: false, error: sanitizeErrorMessage(deleteErr) };
      }

      // 3. Log audit event
      if (adminActor) {
        await supabase.from('audit_logs').insert({
          actor_id: adminActor.id,
          actor_role: 'admin',
          action: 'SOFT_DELETE_LECTURER',
          entity: 'users',
          entity_id: lecturerId,
          metadata: {
            actionOnCourses,
            targetLecturerId: targetLecturerId || null,
            coursesAffected: activeCourseIds.length,
            attendancePreserved: true,
          },
        });
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: sanitizeErrorMessage(err, 'Failed to soft delete lecturer.'),
      };
    }
  }

  static async restoreLecturer(
    lecturerId: string,
    adminActor?: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('users')
        .update({ status: 'active', deleted_at: null })
        .eq('id', lecturerId);

      if (error) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      if (adminActor) {
        await supabase.from('audit_logs').insert({
          actor_id: adminActor.id,
          actor_role: 'admin',
          action: 'RESTORE_LECTURER',
          entity: 'users',
          entity_id: lecturerId,
        });
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async resetLecturerPassword(
    lecturerId: string,
    adminActor?: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('users')
        .update({ must_change_password: true })
        .eq('id', lecturerId);

      if (error) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      if (adminActor) {
        await supabase.from('audit_logs').insert({
          actor_id: adminActor.id,
          actor_role: 'admin',
          action: 'RESET_LECTURER_PASSWORD_FLAG',
          entity: 'users',
          entity_id: lecturerId,
          metadata: { must_change_password: true },
        });
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= COURSES =================

  static async getAllCourses(): Promise<Course[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data: courses, error } = await supabase
        .from('courses')
        .select('*')
        .order('created_at', { ascending: false });

      if (error || !courses) {
        console.error('Failed to load courses:', error);
        return [];
      }

      // Fetch lecturers to map lecturer names
      const { data: lecturers } = await supabase
        .from('users')
        .select('id, name, username, email');

      const lecturerMap = new Map((lecturers || []).map((l: any) => [l.id, l.name || l.username]));

      // Fetch enrolled count per course
      const { data: rosters } = await supabase
        .from('course_roster')
        .select('course_id');

      const rosterCountMap = new Map<string, number>();
      (rosters || []).forEach((r: any) => {
        rosterCountMap.set(r.course_id, (rosterCountMap.get(r.course_id) || 0) + 1);
      });

      // Fetch sessions count per course
      const { data: sessions } = await supabase
        .from('lecture_sessions')
        .select('course_id');

      const sessionCountMap = new Map<string, number>();
      (sessions || []).forEach((s: any) => {
        sessionCountMap.set(s.course_id, (sessionCountMap.get(s.course_id) || 0) + 1);
      });

      return courses.map((c: any) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        lecturer_id: c.lecturer_id,
        lecturer_name: lecturerMap.get(c.lecturer_id) || 'Unassigned',
        department: c.department || 'Computer Science',
        status: c.status,
        created_at: c.created_at,
        enrolled_count: rosterCountMap.get(c.id) || 0,
        sessions_count: sessionCountMap.get(c.id) || 0,
      }));
    } catch (e) {
      console.error('getAllCourses exception:', e);
      return [];
    }
  }

  static async createCourse(
    course: { code: string; title: string; lecturer_id: string; department?: string },
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string; course?: Course }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const codeClean = course.code.trim().toUpperCase();

      // Check 9 active courses limit
      const { count: activeCount } = await supabase
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('lecturer_id', course.lecturer_id)
        .eq('status', 'active');

      const settings = await this.getSettings();
      const maxQuota = settings.max_active_courses_per_lecturer || 9;

      if ((activeCount || 0) >= maxQuota) {
        return {
          success: false,
          error: `Lecturer already has ${activeCount} active courses (Maximum: ${maxQuota}). Archive an existing course first.`,
        };
      }

      // Check duplicate code
      const { data: existing } = await supabase
        .from('courses')
        .select('id')
        .eq('code', codeClean)
        .eq('status', 'active')
        .maybeSingle();

      if (existing) {
        return {
          success: false,
          error: `An active course with code "${codeClean}" already exists.`,
        };
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('courses')
        .insert({
          code: codeClean,
          title: course.title.trim(),
          lecturer_id: course.lecturer_id,
          status: 'active',
        })
        .select()
        .single();

      if (insertErr || !inserted) {
        return { success: false, error: sanitizeErrorMessage(insertErr) };
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: 'CREATE_COURSE',
        entity: 'courses',
        entity_id: inserted.id,
        metadata: { code: inserted.code, title: inserted.title, lecturer_id: inserted.lecturer_id },
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
          enrolled_count: 0,
          sessions_count: 0,
        },
      };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async toggleArchiveCourse(
    courseId: string,
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string; status?: 'active' | 'archived' }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const { data: course, error: fetchErr } = await supabase
        .from('courses')
        .select('id, code, lecturer_id, status')
        .eq('id', courseId)
        .single();

      if (fetchErr || !course) {
        return { success: false, error: 'Course not found.' };
      }

      const nextStatus = course.status === 'active' ? 'archived' : 'active';

      if (nextStatus === 'active') {
        // Check quota before activating
        const { count: activeCount } = await supabase
          .from('courses')
          .select('id', { count: 'exact', head: true })
          .eq('lecturer_id', course.lecturer_id)
          .eq('status', 'active');

        const settings = await this.getSettings();
        const maxQuota = settings.max_active_courses_per_lecturer || 9;

        if ((activeCount || 0) >= maxQuota) {
          return {
            success: false,
            error: `Lecturer already has ${activeCount} active courses. Archive another course first.`,
          };
        }
      }

      const { error: updateErr } = await supabase
        .from('courses')
        .update({ status: nextStatus })
        .eq('id', courseId);

      if (updateErr) {
        return { success: false, error: sanitizeErrorMessage(updateErr) };
      }

      // If archiving, close all active and scheduled sessions
      if (nextStatus === 'archived') {
        await supabase
          .from('lecture_sessions')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('course_id', courseId)
          .in('status', ['active', 'scheduled']);
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: nextStatus === 'archived' ? 'ARCHIVE_COURSE' : 'UNARCHIVE_COURSE',
        entity: 'courses',
        entity_id: courseId,
        metadata: { code: course.code, status: nextStatus },
      });

      return { success: true, status: nextStatus };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  static async reassignCourse(
    courseId: string,
    targetLecturerId: string,
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const settings = await this.getSettings();
      const maxQuota = settings.max_active_courses_per_lecturer || 9;

      const { count: activeCount } = await supabase
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('lecturer_id', targetLecturerId)
        .eq('status', 'active');

      if ((activeCount || 0) >= maxQuota) {
        return {
          success: false,
          error: `Target lecturer already holds ${activeCount} active courses (Maximum: ${maxQuota}).`,
        };
      }

      const { error } = await supabase
        .from('courses')
        .update({ lecturer_id: targetLecturerId })
        .eq('id', courseId);

      if (error) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: 'REASSIGN_COURSE',
        entity: 'courses',
        entity_id: courseId,
        metadata: { new_lecturer_id: targetLecturerId },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= STUDENTS MASTER =================

  static async getStudentsMaster(): Promise<StudentMaster[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('students_master')
        .select('*')
        .order('surname', { ascending: true });

      if (error) {
        console.error('Failed to load students_master:', error);
        return [];
      }

      return (data || []).map((s: any) => ({
        id: s.id,
        matric_no: s.matric_no,
        search_key: s.search_key || '',
        surname: s.surname,
        first_name: s.first_name,
        middle_name: s.middle_name || undefined,
        program: s.program,
        level: String(s.level || '100'),
        email: s.email || undefined,
        phone: s.phone || undefined,
        status: s.status || 'active',
        created_at: s.created_at,
      }));
    } catch (e) {
      console.error('getStudentsMaster exception:', e);
      return [];
    }
  }

  static async importStudentsMaster(
    students: Partial<StudentMaster>[],
    replace: boolean,
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; accepted: number; rejected: number; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, accepted: 0, rejected: students.length, error: 'Database unavailable.' };
    }

    try {
      if (students.length === 0) {
        return { success: true, accepted: 0, rejected: 0 };
      }

      const formatted = students.map(s => {
        const rawMatric = (s.matric_no || '').trim().toUpperCase();
        const searchKey = s.search_key || rawMatric.split('/').pop() || rawMatric;
        let numericLevel = 100;
        if (s.level) {
          const parsed = parseInt(String(s.level).replace(/\D/g, ''), 10);
          if ([100, 200, 300, 400, 500, 600, 700, 800].includes(parsed)) {
            numericLevel = parsed;
          }
        }

        return {
          matric_no: rawMatric,
          search_key: searchKey,
          surname: (s.surname || '').trim(),
          first_name: (s.first_name || '').trim(),
          middle_name: (s.middle_name || '').trim() || null,
          program: (s.program || '').trim(),
          level: numericLevel,
          email: (s.email || '').trim() || null,
          phone: (s.phone || '').trim() || null,
          status: 'active',
        };
      });

      let acceptedCount = 0;
      let rejectedCount = 0;
      const batchSize = 100;

      for (let i = 0; i < formatted.length; i += batchSize) {
        const batch = formatted.slice(i, i + batchSize);
        const { error } = await supabase
          .from('students_master')
          .upsert(batch, { onConflict: 'matric_no' });

        if (error) {
          console.error('Batch insert error on students_master:', error);
          rejectedCount += batch.length;
        } else {
          acceptedCount += batch.length;
        }
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: 'IMPORT_STUDENTS_MASTER',
        entity: 'students_master',
        metadata: {
          total: students.length,
          accepted: acceptedCount,
          rejected: rejectedCount,
          replace,
        },
      });

      return {
        success: acceptedCount > 0,
        accepted: acceptedCount,
        rejected: rejectedCount,
      };
    } catch (e: any) {
      console.error('importStudentsMaster exception:', e);
      return {
        success: false,
        accepted: 0,
        rejected: students.length,
        error: sanitizeErrorMessage(e, 'Failed to import students master directory.'),
      };
    }
  }

  // ================= DEVICE BINDINGS & FORENSIC EVENTS =================

  static async getDeviceBindings(): Promise<DeviceBinding[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('device_bindings')
        .select('*, students_master(matric_no, surname, first_name, middle_name)')
        .order('last_seen_at', { ascending: false });

      if (error) {
        console.error('Failed to load device_bindings:', error);
        return [];
      }

      return (data || []).map((b: any) => {
        const student = b.students_master;
        const studentName = student
          ? `${student.surname} ${student.first_name} ${student.middle_name || ''}`.trim()
          : 'Unknown Student';

        return {
          id: b.id,
          device_id: b.device_id || b.id,
          device_fingerprint_hash: b.fingerprint_hash,
          student_id: b.student_id,
          matric_no: student?.matric_no || 'N/A',
          student_name: studentName,
          matric_hash: b.fingerprint_hash || '',
          user_agent: b.user_agent,
          first_bound_at: b.first_bound_at,
          last_seen_at: b.last_seen_at,
          status: b.status,
          is_shared: Boolean(b.is_shared),
          reset_by: b.reset_by,
          reset_at: b.reset_at,
        };
      });
    } catch (e) {
      console.error('getDeviceBindings exception:', e);
      return [];
    }
  }

  static async getStudentDeviceEvents(studentId: string, limit = 20): Promise<DeviceEvent[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('device_events')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Failed to load device_events:', error);
        return [];
      }

      return (data || []).map((e: any) => ({
        id: e.id,
        student_id: e.student_id,
        matric_no: '',
        event_type: e.event_type,
        reference_code: e.reference_code,
        ip_address: e.ip || '127.0.0.1',
        user_agent: e.user_agent,
        metadata: e.metadata,
        created_at: e.created_at,
      }));
    } catch (e) {
      console.error('getStudentDeviceEvents exception:', e);
      return [];
    }
  }

  static async resetDeviceBinding(
    studentId: string,
    reason: string
  ): Promise<{ success: boolean; error?: string; status?: number }> {
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

    if (result.status === 429) {
      return {
        success: false,
        error: 'Rate limit exceeded: You have exceeded the allowable reset limit. Please wait 60 seconds.',
        status: 429,
      };
    }

    if (!result.success) {
      return {
        success: false,
        error: sanitizeErrorMessage(result.error, 'Failed to reset device binding.'),
        status: result.status,
      };
    }

    return { success: true };
  }

  static async toggleSharedDevice(
    bindingId: string,
    isShared: boolean,
    reason: string,
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      const { error } = await supabase
        .from('device_bindings')
        .update({ is_shared: isShared })
        .eq('id', bindingId);

      if (error) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: isShared ? 'GRANT_SHARED_DEVICE' : 'REVOKE_SHARED_DEVICE',
        entity: 'device_bindings',
        entity_id: bindingId,
        metadata: { reason, is_shared: isShared },
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= SETTINGS =================

  static async getSettings(): Promise<SystemSettings> {
    const defaultSettings: SystemSettings = {
      location_mode: 'evidence_only',
      campus_center_lat: 6.2235,
      campus_center_lng: 6.6180,
      campus_radius_m: 1500,
      location_accuracy_threshold_m: 50,
      default_session_duration_minutes: 60,
      max_session_duration_minutes: 180,
      selfie_retention_days: 180,
      grace_minutes: 10,
      max_active_courses_per_lecturer: 9,
      rate_limit_token_per_minute: 60,
      rate_limit_matric_per_minute: 30,
      updated_at: new Date().toISOString(),
    };

    if (!isSupabaseConfigured || !supabase) return defaultSettings;

    try {
      const { data, error } = await supabase
        .from('settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error || !data) return defaultSettings;

      return {
        ...defaultSettings,
        location_mode: data.location_mode || 'evidence_only',
        campus_boundary_geojson: typeof data.campus_boundary_geojson === 'string'
          ? data.campus_boundary_geojson
          : (data.campus_boundary_geojson ? JSON.stringify(data.campus_boundary_geojson) : ''),
        location_accuracy_threshold_m: data.location_accuracy_threshold_m || 50,
        default_session_duration_minutes: data.default_session_duration_minutes || 60,
        max_session_duration_minutes: data.max_session_duration_minutes || 180,
        selfie_retention_days: data.selfie_retention_days || 180,
        grace_minutes: data.grace_minutes || 10,
        max_active_courses_per_lecturer: data.max_active_courses_per_lecturer || 9,
        rate_limit_token_per_minute: data.rate_limit_token_per_minute || 60,
        rate_limit_matric_per_minute: data.rate_limit_matric_per_minute || 30,
        updated_at: data.updated_at,
      };
    } catch (e) {
      console.warn('getSettings exception:', e);
      return defaultSettings;
    }
  }

  static async updateSettings(
    settings: SystemSettings,
    adminActor: { id: string; name: string }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured || !supabase) {
      return { success: false, error: 'Database unavailable.' };
    }

    try {
      let geojson: any = null;
      if (settings.campus_boundary_geojson && settings.campus_boundary_geojson.trim()) {
        try {
          geojson = JSON.parse(settings.campus_boundary_geojson);
        } catch {
          return { success: false, error: 'Invalid GeoJSON syntax for campus boundary.' };
        }
      }

      const updatePayload: any = {
        location_mode: settings.location_mode,
        location_accuracy_threshold_m: settings.location_accuracy_threshold_m,
        default_session_duration_minutes: settings.default_session_duration_minutes,
        max_session_duration_minutes: settings.max_session_duration_minutes,
        selfie_retention_days: settings.selfie_retention_days,
        grace_minutes: settings.grace_minutes,
        max_active_courses_per_lecturer: settings.max_active_courses_per_lecturer,
        rate_limit_token_per_minute: settings.rate_limit_token_per_minute,
        rate_limit_matric_per_minute: settings.rate_limit_matric_per_minute,
        campus_boundary_geojson: geojson,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('settings')
        .update(updatePayload)
        .eq('id', 1);

      if (error) {
        return { success: false, error: sanitizeErrorMessage(error) };
      }

      await supabase.from('audit_logs').insert({
        actor_id: adminActor.id,
        actor_role: 'admin',
        action: 'UPDATE_SYSTEM_SETTINGS',
        entity: 'settings',
        entity_id: '1',
      });

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeErrorMessage(err) };
    }
  }

  // ================= AUDIT LOGS =================

  static async getAuditLogs(limit = 200): Promise<AuditLog[]> {
    if (!isSupabaseConfigured || !supabase) return [];

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Failed to load audit_logs:', error);
        return [];
      }

      return (data || []).map((l: any) => ({
        id: l.id,
        actor_id: l.actor_id,
        actor_name: l.metadata?.actor_name || (l.actor_role === 'admin' ? 'Administrator' : 'System User'),
        actor_role: l.actor_role,
        action: l.action,
        entity: l.entity,
        entity_id: l.entity_id,
        reference_code: l.metadata?.reference_code,
        metadata: l.metadata,
        created_at: l.created_at,
      }));
    } catch (e) {
      console.error('getAuditLogs exception:', e);
      return [];
    }
  }

  // ================= ANALYTICS =================

  static async getAnalyticsData(): Promise<{
    courses: Course[];
    lecturers: User[];
    sessions: any[];
    records: any[];
    students: StudentMaster[];
    rosters: any[];
  }> {
    if (!isSupabaseConfigured || !supabase) {
      return { courses: [], lecturers: [], sessions: [], records: [], students: [], rosters: [] };
    }

    try {
      const [coursesRes, lecturersRes, sessionsRes, recordsRes, studentsRes, rostersRes] = await Promise.all([
        supabase.from('courses').select('*'),
        supabase.from('users').select('*').eq('role', 'lecturer'),
        supabase.from('lecture_sessions').select('*'),
        supabase.from('attendance_records').select('*'),
        supabase.from('students_master').select('*'),
        supabase.from('course_roster').select('*'),
      ]);

      return {
        courses: coursesRes.data || [],
        lecturers: lecturersRes.data || [],
        sessions: sessionsRes.data || [],
        records: recordsRes.data || [],
        students: studentsRes.data || [],
        rosters: rostersRes.data || [],
      };
    } catch (e) {
      console.error('Failed to fetch analytics data:', e);
      return { courses: [], lecturers: [], sessions: [], records: [], students: [], rosters: [] };
    }
  }

  static async getAnalyticsOverview(): Promise<{
    totalLecturers: number;
    activeLecturers: number;
    totalCourses: number;
    activeCourses: number;
    totalSessions: number;
    totalAttendance: number;
    presentCount: number;
    lateCount: number;
    totalStudentsMaster: number;
  }> {
    const defaultOverview = {
      totalLecturers: 0,
      activeLecturers: 0,
      totalCourses: 0,
      activeCourses: 0,
      totalSessions: 0,
      totalAttendance: 0,
      presentCount: 0,
      lateCount: 0,
      totalStudentsMaster: 0,
    };

    if (!isSupabaseConfigured || !supabase) return defaultOverview;

    try {
      const [lecturersRes, coursesRes, sessionsRes, recordsRes, studentsRes] = await Promise.all([
        supabase.from('users').select('id, status').eq('role', 'lecturer'),
        supabase.from('courses').select('id, status'),
        supabase.from('lecture_sessions').select('id'),
        supabase.from('attendance_records').select('id, status'),
        supabase.from('students_master').select('id'),
      ]);

      const lecturers = lecturersRes.data || [];
      const courses = coursesRes.data || [];
      const sessions = sessionsRes.data || [];
      const records = recordsRes.data || [];
      const students = studentsRes.data || [];

      return {
        totalLecturers: lecturers.length,
        activeLecturers: lecturers.filter((l: any) => l.status === 'active').length,
        totalCourses: courses.length,
        activeCourses: courses.filter((c: any) => c.status === 'active').length,
        totalSessions: sessions.length,
        totalAttendance: records.length,
        presentCount: records.filter((r: any) => r.status === 'present').length,
        lateCount: records.filter((r: any) => r.status === 'late').length,
        totalStudentsMaster: students.length,
      };
    } catch (e) {
      console.error('getAnalyticsOverview exception:', e);
      return defaultOverview;
    }
  }
}
