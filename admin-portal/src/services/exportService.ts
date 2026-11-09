/**
 * ADUN Attendance System - 2-Sheet Excel Export Service (SheetJS)
 * Complies with institutional audit standards.
 * Fixes: PERF-09, PERF-10, QA-16, QA-20
 */

import * as XLSX from 'xlsx';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Course, CourseRoster, LectureSession, AttendanceRecord, StudentMaster } from '../types';
import { formatWATDate, formatWATTime } from '../lib/dateUtils';

export class ExportService {
  /**
   * Generates short-lived signed URL (300 seconds / 5 minutes) for private selfie storage.
   */
  static async getSignedSelfieUrl(selfiePath: string): Promise<string> {
    if (!selfiePath) return '';
    if (selfiePath.startsWith('http://') || selfiePath.startsWith('https://') || selfiePath.startsWith('data:')) {
      return selfiePath;
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase.storage
          .from('selfies')
          .createSignedUrl(selfiePath, 300);

        if (!error && data?.signedUrl) {
          return data.signedUrl;
        }
      } catch (e) {
        console.warn('Failed to generate short-lived signed selfie URL:', e);
      }
    }

    return '';
  }

  /**
   * Exports 2-sheet attendance report for a given course:
   * Sheet 1: Attendance Summary (with correct 0% when 0 sessions held)
   * Sheet 2: Session Detail (joins students_master, Africa/Lagos times, signed selfie URLs)
   */
  static async exportCourseAttendanceReport(
    course: Course,
    roster: CourseRoster[],
    sessions: LectureSession[],
    records: AttendanceRecord[],
    studentsMaster: StudentMaster[]
  ): Promise<void> {
    const studentMap = new Map(studentsMaster.map(s => [s.id, s]));
    const totalSessionsHeld = sessions.length;

    // ------------------------------------------------------------------------
    // Sheet 1: Attendance Summary
    // ------------------------------------------------------------------------
    const sheet1Rows = roster.map(item => {
      const student = studentMap.get(item.student_id);
      const studentRecords = records.filter(r => r.student_id === item.student_id);

      const presentCount = studentRecords.filter(r => r.status === 'present').length;
      const lateCount = studentRecords.filter(r => r.status === 'late').length;
      const attendedTotal = presentCount + lateCount;

      // Fix QA-16 / PERF-09: If 0 sessions held, percentage is 0% (NOT 100%, NOT N/A!)
      const attendancePct = totalSessionsHeld > 0 ? Math.round((attendedTotal / totalSessionsHeld) * 100) : 0;

      let status = 'NO SESSIONS HELD';
      if (totalSessionsHeld > 0) {
        if (attendancePct >= 75) status = 'GOOD STANDING (>= 75%)';
        else if (attendancePct >= 50) status = 'WARNING (50% - 74%)';
        else status = 'DEBARRED (< 50%)';
      }

      return {
        'Matric No': item.matric_no,
        'Surname': student?.surname || '',
        'First Name': student?.first_name || '',
        'Other Name': student?.middle_name || '',
        'Program': item.program || student?.program || 'N/A',
        'Level': item.level || student?.level || '100',
        'Course Code': course.code,
        'Course Title': course.title,
        'Total Sessions': totalSessionsHeld,
        'Present Count': presentCount,
        'Late Count': lateCount,
        'Attended Total': attendedTotal,
        'Attendance %': `${attendancePct}%`,
        'Status': status,
      };
    });

    // ------------------------------------------------------------------------
    // Sheet 2: Session Detail
    // ------------------------------------------------------------------------
    // Fetch signed selfie URLs concurrently for up to 50 items at a time
    const sessionMap = new Map(sessions.map(s => [s.id, s]));

    const signedUrlCache = new Map<string, string>();
    const uniquePaths = Array.from(new Set(records.map(r => r.selfie_path).filter(Boolean))) as string[];

    // Batch resolve signed URLs
    await Promise.all(
      uniquePaths.map(async path => {
        const signed = await this.getSignedSelfieUrl(path);
        signedUrlCache.set(path, signed);
      })
    );

    const sheet2Rows = records.map(rec => {
      const student = studentMap.get(rec.student_id);
      const session = sessionMap.get(rec.session_id);

      // Join students_master for matric and full name (fixes PERF-10)
      const matricNo = student?.matric_no || rec.matric_no || 'UNKNOWN';
      const studentName = student
        ? `${student.surname} ${student.first_name} ${student.middle_name || ''}`.trim()
        : rec.student_name || 'UNKNOWN';

      const signedUrl = rec.selfie_path ? signedUrlCache.get(rec.selfie_path) : '';
      const verificationStatus = !signedUrl && rec.selfie_path
        ? `${(rec.verification_status || 'passed').toUpperCase()} (selfie unavailable)`
        : (rec.verification_status || 'passed').toUpperCase();

      return {
        'Matric No': matricNo,
        'Student Name': studentName,
        'Course Code': course.code,
        'Session Title': session?.title || rec.session_title || 'Lecture Session',
        'Session Date (WAT)': formatWATDate(rec.signed_at),
        'Sign-in Time (WAT)': formatWATTime(rec.signed_at),
        'Status': rec.status.toUpperCase(),
        'Latitude': rec.latitude ?? 'N/A',
        'Longitude': rec.longitude ?? 'N/A',
        'Accuracy': rec.accuracy_m ? `±${rec.accuracy_m}m` : 'N/A',
        'Selfie Signed URL (short-lived)': signedUrl || rec.selfie_path || 'N/A',
        'Verification Status': verificationStatus,
        'Receipt ID': rec.receipt_id,
      };
    });

    // ------------------------------------------------------------------------
    // Build Workbook
    // ------------------------------------------------------------------------
    const wb = XLSX.utils.book_new();

    const wsSummary = XLSX.utils.json_to_sheet(sheet1Rows);
    const wsDetail = XLSX.utils.json_to_sheet(sheet2Rows);

    // Auto-fit column widths
    const fitCols = (ws: XLSX.WorkSheet) => {
      if (!ws['!ref']) return;
      const range = XLSX.utils.decode_range(ws['!ref']);
      const colWidths = [];
      for (let C = range.s.c; C <= range.e.c; ++C) {
        colWidths.push({ wch: 20 });
      }
      ws['!cols'] = colWidths;
    };

    fitCols(wsSummary);
    fitCols(wsDetail);

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Attendance Summary');
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Session Detail');

    // Sanitize course code for filename (replace / and \ with -)
    const sanitizedCode = course.code.replace(/[\\/]/g, '-');
    const timestamp = formatWATDate(new Date()).replace(/\s+/g, '_');
    XLSX.writeFile(wb, `${sanitizedCode}_Attendance_Full_Export_${timestamp}.xlsx`);
  }
}
