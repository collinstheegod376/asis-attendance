/**
 * ADUN Attendance System - Server-Side Device Fingerprint Hashing
 * Enforces server-side salting with zero hardcoded secret fallbacks.
 */
import { sha256Hex } from './crypto.ts';

declare const Deno: any;
declare const process: any;

export function getFingerprintSalt(): string {
  const salt =
    (typeof Deno !== 'undefined'
      ? Deno.env.get('FINGERPRINT_SALT')
      : (typeof process !== 'undefined' ? process.env?.FINGERPRINT_SALT : '')) || '';

  if (!salt || !salt.trim()) {
    throw new Error('FATAL: FINGERPRINT_SALT environment variable is not configured. Failing closed.');
  }
  return salt.trim();
}

/**
 * Hashes raw client fingerprint with server-side salt.
 * Throws if salt is missing. Never stores raw fingerprint values.
 */
export async function hashWithSalt(rawFingerprint: string, overrideSalt?: string): Promise<string> {
  if (!rawFingerprint || typeof rawFingerprint !== 'string' || !rawFingerprint.trim()) {
    throw new Error('rawFingerprint is required for salting and hashing');
  }
  const salt = overrideSalt || getFingerprintSalt();
  return await sha256Hex(`${rawFingerprint.trim()}:${salt}`);
}
