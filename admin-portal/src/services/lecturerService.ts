import * as XLSX from 'xlsx';
import { 
  Course, 
  CourseRoster, 
  LectureSession, 
  AttendanceRecord, 
  StudentMaster, 
  SystemSettings 
} from '../types';
import { AppStorage } from '../lib/storage';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const STORAGE_KEYS = {
  COURSES: 'adun_courses',
  COURSE_ROSTER: 'adun_course_roster',
  SESSIONS: 'adun_sessions',
  ATTENDANCE: 'adun_attendance_records',
};

// SHA-256 helper for session tokens
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate high-entropy token
function generateHighEntropyToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportRosterSummary {
  total: number;
  accepted: number;
  rejected: number;
  acceptedRows: CourseRoster[];
  rejectedRows: Array<{ row: number; matric_no: string; raw_row: any; reason: string }>;
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

  static getLecturerCourses(lecturerId: string): {
    activeCourses: Course[];
    archivedCourses: Course[];
    activeCount: number;
    maxQuota: number;
    canCreateCourse: boolean;
  } {
    const allCourses = AppStorage.getCourses().filter(c => c.lecturer_id === lecturerId);
    const settings = AppStorage.getSettings();
    const maxQuota = settings.max_active_courses_per_lecturer || 9;

    const activeCourses = allCourses.filter(c => c.status === 'active');
    const archivedCourses = allCourses.filter(c => c.status === 'archived');
    const activeCount = activeCourses.length;

    return {
      activeCourses,
      archivedCourses,
      activeCount,
      maxQuota,
      canCreateCourse: activeCount < maxQuota,
    };
  }

  static createCourse(
    lecturerId: string,
    data: { code: string; title: string; department?: string },
    actor: { id: string; name: string }
  ): { success: boolean; error?: string; course?: Course } {
    const quotaCheck = this.getLecturerCourses(lecturerId);
    if (!quotaCheck.canCreateCourse) {
      return {
        success: false,
        error: `Active course limit reached (${quotaCheck.activeCount}/${quotaCheck.maxQuota}). You must archive an existing course to create a new one.`,
      };
    }

    return AppStorage.createCourse(
      {
        code: data.code,
        title: data.title,
        lecturer_id: lecturerId,
        department: data.department,
      },
      actor
    );
  }

  static archiveCourse(
    courseId: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const course = AppStorage.getCourse(courseId);
    if (!course) return { success: false, error: 'Course not found.' };

    if (course.status === 'archived') {
      return { success: true };
    }

    return AppStorage.toggleArchiveCourse(courseId, actor);
  }

  static unarchiveCourse(
    courseId: string,
    lecturerId: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const quotaCheck = this.getLecturerCourses(lecturerId);
    if (quotaCheck.activeCount >= quotaCheck.maxQuota) {
      return {
        success: false,
        error: `Cannot unarchive course. You already have ${quotaCheck.activeCount} active courses (Maximum: ${quotaCheck.maxQuota}). Archive another course first.`,
      };
    }

    return AppStorage.toggleArchiveCourse(courseId, actor);
  }

  // ================= ROSTER SPREADSHEET IMPORT =================

  static parseSpreadsheetFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          resolve(json);
        } catch (err) {
          reject(new Error('Failed to parse spreadsheet file: ' + (err as Error).message));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  }

  static importCourseRoster(
    courseId: string,
    rawRows: any[],
    importMode: 'append' | 'replace',
    actor: { id: string; name: string }
  ): ImportRosterSummary {
    const course = AppStorage.getCourse(courseId);
    if (!course) {
      throw new Error('Course not found.');
    }

    const studentsMaster = AppStorage.getStudentsMaster();
    const existingRosters = AppStorage.getCourseRosters();
    const currentCourseRoster = existingRosters.filter(r => r.course_id === courseId);

    const existingStudentIds = new Set(
      importMode === 'replace' ? [] : currentCourseRoster.map(r => r.student_id)
    );
    const seenMatricsInBatch = new Set<string>();

    const acceptedRows: CourseRoster[] = [];
    const rejectedRows: Array<{ row: number; matric_no: string; raw_row: any; reason: string }> = [];

    rawRows.forEach((row, idx) => {
      const rowNum = idx + 2; // Accounting for 1-based index and header row
      
      // Look for matric number across possible common column names
      const rawMatric = 
        row.matric_no || 
        row['Matric No'] || 
        row['Matric Number'] || 
        row['MATRIC_NO'] || 
        row.matric || 
        row.matriculation_number || 
        '';

      const cleanMatric = AppStorage.normalizeMatric(String(rawMatric));

      if (!cleanMatric) {
        rejectedRows.push({
          row: rowNum,
          matric_no: '',
          raw_row: row,
          reason: 'Missing or empty matric number column.',
        });
        return;
      }

      // Check batch duplicates
      if (seenMatricsInBatch.has(cleanMatric)) {
        rejectedRows.push({
          row: rowNum,
          matric_no: cleanMatric,
          raw_row: row,
          reason: 'Duplicate matric number within this spreadsheet upload.',
        });
        return;
      }
      seenMatricsInBatch.add(cleanMatric);

      // Validate against master student table
      const masterStudent = studentsMaster.find(
        s => AppStorage.normalizeMatric(s.matric_no) === cleanMatric
      );

      if (!masterStudent) {
        rejectedRows.push({
          row: rowNum,
          matric_no: cleanMatric,
          raw_row: row,
          reason: 'Matric number does not exist in University Master Student directory.',
        });
        return;
      }

      // Check if already enrolled in this course (for append mode)
      if (importMode === 'append' && existingStudentIds.has(masterStudent.id)) {
        rejectedRows.push({
          row: rowNum,
          matric_no: cleanMatric,
          raw_row: row,
          reason: 'Student is already enrolled in this course roster.',
        });
        return;
      }

      // Accepted row
      existingStudentIds.add(masterStudent.id);
      const studentFullName = `${masterStudent.surname} ${masterStudent.first_name} ${masterStudent.middle_name || ''}`.trim();

      acceptedRows.push({
        id: 'rst_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        course_id: courseId,
        student_id: masterStudent.id,
        matric_no: masterStudent.matric_no,
        student_name: studentFullName,
        program: masterStudent.program,
        level: masterStudent.level,
        uploaded_by: actor.id,
        uploaded_at: new Date().toISOString(),
      });
    });

    // Save to storage
    let updatedRoster: CourseRoster[];
    if (importMode === 'replace') {
      // Keep other courses rosters, replace this course's roster
      updatedRoster = existingRosters.filter(r => r.course_id !== courseId).concat(acceptedRows);
    } else {
      updatedRoster = [...existingRosters, ...acceptedRows];
    }

    localStorage.setItem(STORAGE_KEYS.COURSE_ROSTER, JSON.stringify(updatedRoster));

    // Audit log
    AppStorage.logAudit(
      actor.id,
      actor.name,
      'lecturer',
      'IMPORT_COURSE_ROSTER',
      'course_roster',
      courseId,
      {
        courseCode: course.code,
        importMode,
        totalRows: rawRows.length,
        acceptedCount: acceptedRows.length,
        rejectedCount: rejectedRows.length,
      }
    );

    return {
      total: rawRows.length,
      accepted: acceptedRows.length,
      rejected: rejectedRows.length,
      acceptedRows,
      rejectedRows,
    };
  }

  static downloadRejectedRowsCSV(
    courseCode: string,
    rejectedRows: Array<{ row: number; matric_no: string; raw_row: any; reason: string }>
  ): void {
    const exportData = rejectedRows.map(r => ({
      'Row Number': r.row,
      'Matric Number': r.matric_no || 'EMPTY',
      'Rejection Reason': r.reason,
      ...r.raw_row,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rejected Rows');
    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `${courseCode}_Roster_Rejected_Rows_${timestamp}.xlsx`);
  }

  static removeStudentFromRoster(
    rosterId: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const rosters = AppStorage.getCourseRosters();
    const entry = rosters.find(r => r.id === rosterId);
    if (!entry) return { success: false, error: 'Student roster entry not found.' };

    const filtered = rosters.filter(r => r.id !== rosterId);
    localStorage.setItem(STORAGE_KEYS.COURSE_ROSTER, JSON.stringify(filtered));

    AppStorage.logAudit(
      actor.id,
      actor.name,
      'lecturer',
      'REMOVE_STUDENT_FROM_ROSTER',
      'course_roster',
      rosterId,
      { matric_no: entry.matric_no, student_name: entry.student_name, course_id: entry.course_id }
    );

    return { success: true };
  }

  // ================= SESSION MANAGEMENT & TOKENS =================

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
    const course = AppStorage.getCourse(courseId);
    if (!course) return { success: false, error: 'Course not found.' };

    const settings = AppStorage.getSettings();
    const maxDuration = settings.max_session_duration_minutes || 180;
    const duration = Math.min(Math.max(1, data.duration_minutes), maxDuration);
    const graceMinutes = data.grace_minutes !== undefined ? data.grace_minutes : (settings.grace_minutes || 10);

    const startsAtDate = new Date(data.starts_at);
    const expiresAtDate = new Date(startsAtDate.getTime() + duration * 60 * 1000);

    const rawToken = generateHighEntropyToken();
    const tokenHash = await sha256(rawToken);

    const newSession: LectureSession = {
      id: 'ses_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      course_id: courseId,
      course_code: course.code,
      course_title: course.title,
      lecturer_id: course.lecturer_id,
      lecturer_name: course.lecturer_name,
      title: data.title.trim(),
      token_hash: tokenHash,
      raw_token: rawToken, // Kept in session record for projector mode QR display
      starts_at: startsAtDate.toISOString(),
      expires_at: expiresAtDate.toISOString(),
      duration_minutes: duration,
      grace_minutes: graceMinutes,
      status: 'active',
      created_by: actor.id,
      created_at: new Date().toISOString(),
    };

    const sessions = AppStorage.getSessions();
    sessions.unshift(newSession);
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

    AppStorage.logAudit(
      actor.id,
      actor.name,
      'lecturer',
      'CREATE_LECTURE_SESSION',
      'lecture_sessions',
      newSession.id,
      {
        courseCode: course.code,
        sessionTitle: newSession.title,
        durationMinutes: duration,
        startsAt: newSession.starts_at,
        expiresAt: newSession.expires_at,
      }
    );

    return {
      success: true,
      session: newSession,
      rawToken,
    };
  }

  static closeLectureSession(
    sessionId: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const sessions = AppStorage.getSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return { success: false, error: 'Lecture session not found.' };

    session.status = 'closed';
    session.closed_at = new Date().toISOString();
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));

    AppStorage.logAudit(
      actor.id,
      actor.name,
      'lecturer',
      'CLOSE_LECTURE_SESSION',
      'lecture_sessions',
      sessionId,
      { sessionTitle: session.title, course_id: session.course_id }
    );

    return { success: true };
  }

  static getSessionById(sessionId: string): LectureSession | undefined {
    return AppStorage.getSessions().find(s => s.id === sessionId);
  }

  static getCourseSessions(courseId: string): LectureSession[] {
    return AppStorage.getSessions()
      .filter(s => s.course_id === courseId)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }

  static getSessionAttendanceRecords(sessionId: string): AttendanceRecord[] {
    return AppStorage.getAttendanceRecords()
      .filter(r => r.session_id === sessionId)
      .sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime());
  }

  // ================= ATTENDANCE SUMMARY & CALENDAR =================

  static getCourseAttendanceSummary(courseId: string): StudentAttendanceSummary[] {
    const roster = AppStorage.getCourseRoster(courseId);
    const sessions = this.getCourseSessions(courseId);
    const attendanceRecords = AppStorage.getAttendanceRecords().filter(r => r.course_id === courseId);

    const totalSessionsHeld = sessions.length;

    return roster.map(student => {
      const studentRecords = attendanceRecords
        .filter(r => r.student_id === student.student_id)
        .sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime());

      const attendedSessions = studentRecords.length;
      const attendancePercentage = totalSessionsHeld > 0 
        ? Math.round((attendedSessions / totalSessionsHeld) * 100) 
        : 100;

      const lastRecord = studentRecords[0] || null;

      let lastDate: string | null = null;
      let lastTime: string | null = null;
      if (lastRecord) {
        const d = new Date(lastRecord.signed_at);
        lastDate = d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
        lastTime = d.toLocaleTimeString('en-GB', { 
          timeZone: 'Africa/Lagos', 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        });
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

  static getStudentCalendarDetails(
    courseId: string, 
    studentId: string
  ): {
    student: StudentMaster | undefined;
    sessions: StudentCalendarSessionDetail[];
    overallPercentage: number;
    attendedCount: number;
    totalSessions: number;
  } {
    const student = AppStorage.getStudentsMaster().find(s => s.id === studentId);
    const allCourseSessions = this.getCourseSessions(courseId);
    const studentRecords = AppStorage.getAttendanceRecords().filter(
      r => r.course_id === courseId && r.student_id === studentId
    );

    const sessionDetails: StudentCalendarSessionDetail[] = allCourseSessions.map(session => {
      const record = studentRecords.find(r => r.session_id === session.id);
      const sessionDateStr = new Date(session.starts_at).toLocaleDateString('en-GB', { 
        timeZone: 'Africa/Lagos' 
      });

      if (record) {
        const proxyRisk: 'low' | 'medium' | 'high' = record.proxy_risk || 
          (record.verification_status === 'manual_review' ? 'medium' : 'low');
        const fpSnapshot = record.fingerprint_snapshot_ref || 
          `DEV-SNAP-${(record.device_id || record.receipt_id || record.id).slice(0, 10).toUpperCase()}`;

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
          selfie_url: record.selfie_url || null,
          selfie_path: record.selfie_path || null,
          verification_status: record.verification_status,
          receipt_id: record.receipt_id,
          proxy_risk: proxyRisk,
          fingerprint_snapshot_ref: fpSnapshot,
          device_id: record.device_id,
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
    const totalSessions = allCourseSessions.length;
    const overallPercentage = totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : 100;

    return {
      student,
      sessions: sessionDetails,
      overallPercentage,
      attendedCount,
      totalSessions,
    };
  }

  // ================= 2-SHEET EXCEL EXPORT (SHEETJS) =================

  static async exportTwoSheetExcel(courseId: string): Promise<void> {
    const course = AppStorage.getCourse(courseId);
    if (!course) throw new Error('Course not found');

    const summaryData = this.getCourseAttendanceSummary(courseId);
    const allStudentsMaster = AppStorage.getStudentsMaster();
    const sessions = this.getCourseSessions(courseId);
    const attendanceRecords = AppStorage.getAttendanceRecords().filter(r => r.course_id === courseId);

    // Sheet 1: Attendance Summary
    // Matric No, Surname, First Name, Other Name, Program, Level, Course Code, Course Title, Total Sessions, Sessions Attended, Attendance %, Last Signed Date, Last Signed Time, Last Status
    const sheet1Rows = summaryData.map(item => {
      const studentMaster = allStudentsMaster.find(s => s.id === item.student_id);
      return {
        'Matric No': item.matric_no,
        'Surname': studentMaster?.surname || '',
        'First Name': studentMaster?.first_name || '',
        'Other Name': studentMaster?.middle_name || '',
        'Program': item.program,
        'Level': item.level,
        'Course Code': course.code,
        'Course Title': course.title,
        'Total Sessions': item.total_sessions,
        'Sessions Attended': item.attended_sessions,
        'Attendance %': `${item.attendance_percentage}%`,
        'Last Signed Date': item.last_signed_date || 'N/A',
        'Last Signed Time': item.last_signed_time || 'N/A',
        'Last Status': item.last_status ? item.last_status.toUpperCase() : 'NEVER SIGNED',
      };
    });

    // Sheet 2: Session Detail
    // Matric No, Student Name, Course Code, Session Title, Session Date, Sign-in Time, Status, Proxy Risk, Fingerprint Snapshot Ref, Latitude, Longitude, Accuracy, Verification Status, Receipt ID
    const sheet2Rows: any[] = [];
    sessions.forEach(session => {
      const recordsForSession = attendanceRecords.filter(r => r.session_id === session.id);
      recordsForSession.forEach(rec => {
        const d = new Date(rec.signed_at);
        const lagosDate = d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' });
        const lagosTime = d.toLocaleTimeString('en-GB', { 
          timeZone: 'Africa/Lagos', 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        });

        const proxyRisk = (rec.proxy_risk || (rec.verification_status === 'manual_review' ? 'medium' : 'low')).toUpperCase();
        const fpSnapshot = rec.fingerprint_snapshot_ref || `DEV-SNAP-${(rec.device_id || rec.receipt_id || rec.id).slice(0, 10).toUpperCase()}`;

        sheet2Rows.push({
          'Matric No': rec.matric_no,
          'Student Name': rec.student_name,
          'Course Code': course.code,
          'Session Title': session.title,
          'Session Date': lagosDate,
          'Sign-in Time': lagosTime,
          'Status': rec.status.toUpperCase(),
          'Proxy Risk': proxyRisk,
          'Fingerprint Snapshot Ref': fpSnapshot,
          'Latitude': rec.latitude ?? 'N/A',
          'Longitude': rec.longitude ?? 'N/A',
          'Accuracy (m)': rec.accuracy_m ? `±${rec.accuracy_m}m` : 'N/A',
          'Verification Status': (rec.verification_status || 'passed').toUpperCase(),
          'Receipt ID': rec.receipt_id || 'N/A',
        });
      });
    });

    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.json_to_sheet(sheet1Rows);
    const wsDetail = XLSX.utils.json_to_sheet(sheet2Rows);

    // Auto-fit column widths
    const fitCols = (ws: XLSX.WorkSheet) => {
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      const colWidths = [];
      for (let C = range.s.c; C <= range.e.c; ++C) {
        colWidths.push({ wch: 18 });
      }
      ws['!cols'] = colWidths;
    };

    fitCols(wsSummary);
    fitCols(wsDetail);

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Attendance Summary');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Session Detail');

    const timestamp = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${course.code}_Attendance_Full_Export_${timestamp}.xlsx`);
  }

  // ================= EMERGENCY DEVICE RESET =================
  static emergencyResetDevice(
    studentId: string,
    courseId: string,
    reason: string,
    actor: { id: string; name: string }
  ): { success: boolean; error?: string } {
    const course = AppStorage.getCourse(courseId);
    return AppStorage.lecturerResetDeviceBinding(
      studentId,
      reason,
      { id: actor.id, name: actor.name, role: 'lecturer' },
      course ? { course_id: course.id, course_code: course.code } : undefined
    );
  }

  // ================= STORAGE SIGNED URL HELPER =================

  static async getSelfieSignedUrl(selfiePath: string): Promise<string> {
    if (!selfiePath) return '';
    // If it's already an HTTP URL or data URL
    if (selfiePath.startsWith('http://') || selfiePath.startsWith('https://') || selfiePath.startsWith('data:')) {
      return selfiePath;
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.storage
          .from('selfies')
          .createSignedUrl(selfiePath, 300); // 5 minutes TTL
        if (!error && data?.signedUrl) {
          return data.signedUrl;
        }
      } catch (e) {
        console.error('Failed to create signed URL from Supabase storage:', e);
      }
    }

    return '';
  }
}
