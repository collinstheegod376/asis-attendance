/**
 * Cryptographic & Device Binding Utilities
 * Fixes: QA-05, PERF-15, SEC-19
 */

const APP_SALT = 'ADUN_ATTENDANCE_SALT_v1';
const DEVICE_ID_KEY = 'adun_device_uuid';
const DEVICE_BINDING_KEY = 'adun_device_binding';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Computes SHA-256 hex string using browser Web Crypto API
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalizes matric numbers: strips all whitespace, uppercase
 * Fixes SEC-19
 */
export function normalizeMatric(matric: string): string {
  return (matric || '').toUpperCase().trim().replace(/\s+/g, '');
}

/**
 * Generates an RFC-4122 v4 compliant UUID
 */
function generateUUIDv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Pure Math.random fallback strictly matching RFC-4122 v4 structure
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Gets or creates a persistent RFC-4122 UUID v4 for this device.
 * Never returns dev_* or temp_device_* (Fixes QA-05)
 */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id || !UUID_V4_REGEX.test(id.trim())) {
      id = generateUUIDv4();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id.trim();
  } catch {
    return generateUUIDv4();
  }
}

export interface ClientDeviceBindingHint {
  hasBinding: boolean;
  isMatch: boolean;
  boundMatricDisplay?: string;
}

/**
 * Reads client-side localStorage binding hint.
 * Informational UX hint only — NEVER authoritative, NEVER hard-blocks (Fixes QA-04, SEC-12).
 */
export async function checkDeviceBinding(matric: string): Promise<ClientDeviceBindingHint> {
  const normalized = normalizeMatric(matric);
  if (!normalized) {
    return { hasBinding: false, isMatch: false };
  }

  const incomingHash = await sha256Hex(normalized + ':' + APP_SALT);

  try {
    const raw = localStorage.getItem(DEVICE_BINDING_KEY);
    if (!raw) {
      return { hasBinding: false, isMatch: false };
    }

    const binding = JSON.parse(raw);
    if (binding && binding.matric_hash) {
      const isMatch = binding.matric_hash === incomingHash;
      return {
        hasBinding: true,
        isMatch,
        boundMatricDisplay: binding.matric_display,
      };
    }
  } catch (e) {
    console.error('Error parsing device binding:', e);
  }

  return { hasBinding: false, isMatch: false };
}

/**
 * Saves or updates matric binding in localStorage post-confirmation ONLY
 * (Fixes SEC-12).
 */
export async function bindDeviceToMatric(matric: string): Promise<void> {
  const normalized = normalizeMatric(matric);
  const hash = await sha256Hex(normalized + ':' + APP_SALT);
  const deviceId = getOrCreateDeviceId();
  const now = new Date().toISOString();

  const binding = {
    device_id: deviceId,
    matric_hash: hash,
    matric_display: normalized,
    first_bound_at: now,
    last_seen_at: now,
  };

  try {
    localStorage.setItem(DEVICE_BINDING_KEY, JSON.stringify(binding));
  } catch (e) {
    console.warn('Failed to store device binding in localStorage:', e);
  }
}

/**
 * Formats a timestamp into Africa/Lagos timezone (GMT+1)
 */
export function formatToLagosTime(dateInput: Date | string = new Date()): string {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);
}

/**
 * Generates client idempotency key (valid UUID v4)
 */
export function generateIdempotencyKey(): string {
  return generateUUIDv4();
}
