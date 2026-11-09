/**
 * ADUN Attendance System - UI Preferences Storage & Utility Helpers
 * DESTRUCTIVE 3-SECOND FULL-TABLE POLLING AND MOCK DATA COMPLETELY REMOVED.
 * Source of truth for business data is strictly Supabase database and Edge Functions.
 * LocalStorage is restricted exclusively to ephemeral client UI preferences.
 * Fixes: QA-02, QA-03, PERF-03
 */

const UI_PREF_KEYS = {
  SIDEBAR_COLLAPSED: 'adun_ui_sidebar_collapsed',
  THEME: 'adun_ui_theme',
  LAST_SELECTED_COURSE: 'adun_ui_last_course',
};

export class UIPreferences {
  static isSidebarCollapsed(): boolean {
    try {
      return localStorage.getItem(UI_PREF_KEYS.SIDEBAR_COLLAPSED) === 'true';
    } catch {
      return false;
    }
  }

  static setSidebarCollapsed(collapsed: boolean): void {
    try {
      localStorage.setItem(UI_PREF_KEYS.SIDEBAR_COLLAPSED, String(collapsed));
    } catch {}
  }

  static getLastSelectedCourseId(): string | null {
    try {
      return localStorage.getItem(UI_PREF_KEYS.LAST_SELECTED_COURSE);
    } catch {
      return null;
    }
  }

  static setLastSelectedCourseId(courseId: string): void {
    try {
      localStorage.setItem(UI_PREF_KEYS.LAST_SELECTED_COURSE, courseId);
    } catch {}
  }
}

/**
 * Standard matriculation number normalizer.
 * Removes extra whitespace, standardizes slashes and uppercase.
 */
export function normalizeMatric(raw: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[\\–—]/g, '/');
}

/**
 * Backward-compatible facade for legacy imports.
 * Delegates to modern typed services or UI preferences.
 * Polling loops and local mock state are completely eradicated.
 */
export class AppStorage {
  static normalizeMatric(raw: string): string {
    return normalizeMatric(raw);
  }

  static init(): void {
    // No-op: Supabase Auth and database tables govern system state
  }

  static startServerSync(): void {
    // No-op: Destructive 3s poll eliminated (Fixes QA-02, PERF-03)
  }

  static syncFromSupabase(): Promise<void> {
    // No-op: Targeted service queries replace destructive full dump
    return Promise.resolve();
  }
}
