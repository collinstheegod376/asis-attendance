/**
 * ADUN Attendance System - Course Roster Import Service
 * Calls Edge Function /api/import-roster with authenticated JWT.
 * Strictly verifies against students_master and NEVER auto-creates students in students_master.
 * Fixes: QA-12, PERF-16
 */

import * as XLSX from 'xlsx';
import { callEdgeFunction } from './apiClient';

export interface RosterImportResponse {
  accepted: string[];
  rejected: Array<{
    row: number;
    matric?: string;
    reason: string;
  }>;
}

export class RosterService {
  /**
   * Parses an uploaded roster Excel (.xlsx, .xls) or CSV file using SheetJS.
   */
  static parseSpreadsheetFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
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
      reader.onerror = err => reject(err);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Dispatches bulk roster rows to the server Edge Function for validation and atomic enrollment.
   */
  static async importCourseRoster(
    courseId: string,
    rawRows: any[],
    mode: 'append' | 'replace' = 'append'
  ): Promise<{
    success: boolean;
    accepted: string[];
    rejected: Array<{ row: number; matric?: string; reason: string }>;
    error?: string;
  }> {
    const result = await callEdgeFunction<RosterImportResponse>('import-roster', {
      course_id: courseId,
      mode,
      rows: rawRows,
    });

    if (!result.success || !result.data) {
      return {
        success: false,
        accepted: [],
        rejected: [],
        error: result.error || 'Roster import failed on server.',
      };
    }

    return {
      success: true,
      accepted: result.data.accepted || [],
      rejected: result.data.rejected || [],
    };
  }

  /**
   * Downloads a structured spreadsheet of all rejected rows with reasons and row indices.
   */
  static downloadRejectedRowsFile(
    courseCode: string,
    rejectedRows: Array<{ row: number; matric?: string; reason: string }>
  ): void {
    const exportData = rejectedRows.map(r => ({
      'Row Number': r.row,
      'Matriculation Number': r.matric || 'N/A',
      'Rejection Reason': r.reason,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rejected Entries');
    const sanitizedCode = courseCode.replace(/[\\/]/g, '-');
    XLSX.writeFile(workbook, `${sanitizedCode}_Roster_Rejected_Entries_${Date.now()}.xlsx`);
  }
}
