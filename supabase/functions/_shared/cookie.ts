/**
 * ADUN Attendance System - Strict Device Binding Cookie & HMAC Infrastructure
 * Option 2: Strict Device Binding Specification
 * Enforces HMAC-SHA256 signature, HttpOnly/Secure/SameSite=Lax headers, and zero secret fallbacks.
 */
import { sha256Hex } from './crypto.ts';

declare const Deno: any;
declare const process: any;

export function getDeviceCookieSecret(): string {
  const secret =
    (typeof Deno !== 'undefined'
      ? Deno.env.get('DEVICE_COOKIE_SECRET')
      : (typeof process !== 'undefined' ? process.env?.DEVICE_COOKIE_SECRET : '')) || '';

  if (!secret || !secret.trim()) {
    throw new Error('FATAL: DEVICE_COOKIE_SECRET environment variable is not configured. Failing closed.');
  }
  return secret.trim();
}

/**
 * Parses cookies from HTTP Cookie header into key-value map.
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
 * Issues an HMAC-SHA256 signed trusted-device token for a student and bound fingerprint.
 * Format: <base64Payload>.<hmacHexSignature>
 */
export async function createSignedCookieToken(
  studentId: string,
  fingerprintHash: string,
  overrideSecret?: string
): Promise<string> {
  const secret = overrideSecret || getDeviceCookieSecret();
  const payloadObj = {
    sub: studentId,
    fp: fingerprintHash,
    iat: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  };

  const payloadStr = JSON.stringify(payloadObj);
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payloadStr);

  let binary = '';
  for (let i = 0; i < payloadBytes.length; i++) {
    binary += String.fromCharCode(payloadBytes[i]);
  }
  const payloadB64 = btoa(binary);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
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
 * Verifies an HMAC-SHA256 signed trusted-device token.
 * Returns studentId and fingerprintHash if signature is valid.
 */
export async function verifySignedCookieToken(
  token: string | null | undefined,
  overrideSecret?: string
): Promise<{ valid: boolean; studentId?: string; fingerprintHash?: string }> {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false };
  }

  try {
    const secret = overrideSecret || getDeviceCookieSecret();
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false };

    const [payloadB64, sigHex] = parts;
    if (!payloadB64 || !sigHex || sigHex.length !== 64) {
      return { valid: false };
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

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

    const decodedStr = atob(payloadB64);
    const payload = JSON.parse(decodedStr);

    return {
      valid: true,
      studentId: payload?.sub,
      fingerprintHash: payload?.fp,
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Serializes standard HttpOnly, Secure, SameSite=Lax cookie string.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    maxAge?: number;
    path?: string;
  } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

/**
 * Standard Set-Cookie header string for adun_trusted_device
 * 1-year expiration (Max-Age=31536000), HttpOnly, Secure, SameSite=Lax
 */
export function createDeviceCookieHeader(token: string): string {
  return serializeCookie('adun_trusted_device', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 31536000,
  });
}
