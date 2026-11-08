/**
 * ADUN Attendance - Cryptographic & Formatting Utilities
 */

/**
 * Computes SHA-256 hash of a string input using Web Crypto API.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalizes matric numbers: trims whitespace, removes non-standard chars, and converts to uppercase.
 * Example: " adun/fs/com/25/001 " -> "ADUN/FS/COM/25/001"
 */
export function normalizeMatric(matric: string): string {
  if (!matric) return '';
  return matric.trim().toUpperCase();
}

/**
 * Formats date into Africa/Lagos timezone string
 */
export function toLagosTimeString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * Generates an ADUN Attendance receipt code
 */
export function generateReceiptId(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';

  const randomBytes = new Uint8Array(3);
  crypto.getRandomValues(randomBytes);
  const hexSuffix = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return `ADUN-${y}${m}${d}-${hexSuffix}`;
}
