/**
 * ADUN Attendance - Strict Device Binding Cookie & HMAC Utilities
 * Per ADUN_ATTENDANCE_DEVICE_BINDING_SPEC.txt Option 2 Strict Device Binding
 */
import { sha256Hex } from './crypto.ts';

declare const Deno: any;
declare const process: any;

const HMAC_SECRET =
  (typeof Deno !== 'undefined'
    ? Deno.env.get('DEVICE_COOKIE_SECRET') || Deno.env.get('JWT_SECRET')
    : (typeof process !== 'undefined' ? process.env?.DEVICE_COOKIE_SECRET : '')) ||
  'adun_strict_device_binding_secret_key_2026_lagos_nigeria_min_32_bytes';

const FINGERPRINT_SALT =
  (typeof Deno !== 'undefined'
    ? Deno.env.get('DEVICE_SALT')
    : (typeof process !== 'undefined' ? process.env?.DEVICE_SALT : '')) ||
  'adun_attendance_device_salt_2026';

/**
 * Parses cookies from HTTP Cookie header into a key-value record
 */
export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key) {
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}

/**
 * Hashes a client-generated fingerprint with the server-side salt
 * Never stores raw fingerprint values
 */
export async function hashFingerprint(rawFingerprint: string): Promise<string> {
  if (!rawFingerprint || !rawFingerprint.trim()) return '';
  return await sha256Hex(`${rawFingerprint.trim()}:${FINGERPRINT_SALT}`);
}

/**
 * Issues an HMAC-SHA256 signed trusted-device token for a student
 * Token format: <base64Payload>.<hmacHexSignature>
 */
export async function createSignedCookieToken(studentId: string): Promise<string> {
  const payloadObj = {
    sub: studentId,
    iat: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  const payloadStr = JSON.stringify(payloadObj);
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payloadStr);

  // Convert payload to Base64
  let binary = '';
  for (let i = 0; i < payloadBytes.length; i++) {
    binary += String.fromCharCode(payloadBytes[i]);
  }
  const payloadB64 = btoa(binary);

  // Import HMAC key
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigArray = Array.from(new Uint8Array(sigBuffer));
  const sigHex = sigArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return `${payloadB64}.${sigHex}`;
}

/**
 * Verifies an HMAC-SHA256 signed trusted-device token
 * Returns validation status and student identity if valid
 */
export async function verifySignedCookieToken(
  token: string | null | undefined
): Promise<{ valid: boolean; studentId?: string }> {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false };
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false };

    const [payloadB64, sigHex] = parts;
    if (!payloadB64 || !sigHex || sigHex.length !== 64) {
      return { valid: false };
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(HMAC_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Convert hex string to Uint8Array
    const sigBytes = new Uint8Array(
      sigHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(payloadB64)
    );

    if (!isValid) {
      return { valid: false };
    }

    // Decode payload
    const decodedStr = atob(payloadB64);
    const payload = JSON.parse(decodedStr);

    return {
      valid: true,
      studentId: payload?.sub,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Creates the standard Set-Cookie header string for adun_trusted_device
 * Attributes: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=31536000 (1 year)
 */
export function createDeviceCookieHeader(token: string): string {
  return `adun_trusted_device=${encodeURIComponent(
    token
  )}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}
