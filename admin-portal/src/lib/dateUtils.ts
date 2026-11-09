/**
 * ADUN Attendance System - Africa/Lagos (WAT, UTC+1) Date & Time Utilities
 * Standardized across all admin and lecturer views.
 * Fixes: QA-20, PERF-20
 */

export interface WATDateParts {
  year: number;
  month: number; // 0-indexed (0 = Jan, 11 = Dec)
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Extracts date and time components strictly according to Africa/Lagos timezone (UTC+1).
 */
export function getWATDateParts(date: Date | string | number): WATDateParts {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return getWATDateParts(now);
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  return {
    year: parseInt(partMap.year, 10),
    month: parseInt(partMap.month, 10) - 1,
    day: parseInt(partMap.day, 10),
    hour: parseInt(partMap.hour || '0', 10),
    minute: parseInt(partMap.minute || '0', 10),
    second: parseInt(partMap.second || '0', 10),
  };
}

/**
 * Generates a stable calendar bucketing key "YYYY-M-D" in Africa/Lagos time.
 * Even if the user's browser is in UTC, GMT-5, or GMT+9, sessions bucket into
 * the exact Nigerian calendar day.
 */
export function getWATDateKey(date: Date | string | number): string {
  const { year, month, day } = getWATDateParts(date);
  return `${year}-${month}-${day}`;
}

/**
 * Formats date string in Africa/Lagos timezone (e.g. "09 Nov 2026").
 */
export function formatWATDate(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/**
 * Formats time string in Africa/Lagos timezone with 'WAT' appended (e.g. "09:30:00 WAT").
 */
export function formatWATTime(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  return `${timeStr} WAT`;
}

/**
 * Formats full datetime string in Africa/Lagos timezone with 'WAT' appended.
 * e.g. "09 Nov 2026, 09:30:00 WAT"
 */
export function formatWATDateTime(date: Date | string | number): string {
  const d = typeof date === 'object' ? date : new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  return `${formatWATDate(d)}, ${formatWATTime(d)}`;
}

/**
 * Parses an HTML5 datetime-local string (e.g. "2026-11-09T08:30") as Africa/Lagos time (UTC+1).
 * Appends +01:00 before instantiating Date to avoid client browser timezone shifts.
 */
export function parseDateTimeLocalAsWAT(datetimeLocalVal: string): string {
  if (!datetimeLocalVal) return new Date().toISOString();
  if (datetimeLocalVal.includes('+') || datetimeLocalVal.includes('Z')) {
    return new Date(datetimeLocalVal).toISOString();
  }
  // Standard format "YYYY-MM-DDTHH:mm" -> append ":00+01:00"
  const formatted = datetimeLocalVal.length === 16 ? `${datetimeLocalVal}:00+01:00` : `${datetimeLocalVal}+01:00`;
  const d = new Date(formatted);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Formats an ISO string or Date for HTML5 datetime-local input, representing the Africa/Lagos time.
 */
export function formatToDateTimeLocalWAT(date: Date | string | number): string {
  const { year, month, day, hour, minute } = getWATDateParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}
