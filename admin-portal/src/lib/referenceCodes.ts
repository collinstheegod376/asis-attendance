/**
 * ADUN Attendance System - Unified Reference Code Taxonomy & Mapping
 * Matches exact schema and Edge Functions taxonomy: BIND-200 through BIND-206.
 * Supports prefix matching for forensic hex suffixes (e.g. BIND-201-A4F2).
 * Fixes: SEC-20, QA-13, PERF-13
 */

export type ReferenceCode =
  | 'BIND-200'
  | 'BIND-201'
  | 'BIND-202'
  | 'BIND-203'
  | 'BIND-204'
  | 'BIND-205'
  | 'BIND-206';

export const REFERENCE_CODE_MAP: Record<string, string> = {
  'BIND-200': 'Binding Verified / Valid Matching Device',
  'BIND-201': 'New Device Detected (Fingerprint / Hardware Mismatch)',
  'BIND-202': 'Device Already Bound to Another Active Student',
  'BIND-203': 'Same-Session Device Collision (Proxy Detected)',
  'BIND-204': 'Unrecognized Device / Missing Trusted Cookie',
  'BIND-205': 'Incognito / Private Browsing Detected',
  'BIND-206': 'Administrative Device Reset Performed',
};

export const REFERENCE_CODES_LIST = [
  { code: 'BIND-200', label: 'BIND-200 — Binding Verified / Valid Matching Device' },
  { code: 'BIND-201', label: 'BIND-201 — New Device / Fingerprint Mismatch' },
  { code: 'BIND-202', label: 'BIND-202 — Device Bound to Another Student' },
  { code: 'BIND-203', label: 'BIND-203 — Same-Session Device Collision' },
  { code: 'BIND-204', label: 'BIND-204 — Unrecognized Device / Missing Cookie' },
  { code: 'BIND-205', label: 'BIND-205 — Incognito / Private Browsing' },
  { code: 'BIND-206', label: 'BIND-206 — Admin Reset Performed' },
];

/**
 * Filter reference code with prefix matching (startsWith).
 * e.g. "BIND-201" matches "BIND-201-A4F2" or "BIND-201".
 */
export function matchReferenceCode(code: string | null | undefined, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  if (!code) return false;
  return code.toLowerCase().startsWith(filter.toLowerCase());
}

/**
 * Formats a reference code for display, showing both the canonical description
 * and any full forensic code or suffix.
 * e.g. "BIND-201-A4F2" -> "BIND-201 — New Device Detected [BIND-201-A4F2]"
 */
export function formatReferenceCode(code: string | null | undefined): string {
  if (!code) return 'N/A';
  const clean = code.trim().toUpperCase();
  const prefix = clean.slice(0, 8); // e.g. "BIND-201"
  const label = REFERENCE_CODE_MAP[prefix];

  if (label) {
    return clean.length > 8 ? `${prefix} — ${label} [${clean}]` : `${prefix} — ${label}`;
  }

  return clean;
}
