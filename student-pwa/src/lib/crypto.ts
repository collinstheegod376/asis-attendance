/**
 * Cryptographic & Device Binding Utilities
 */

const APP_SALT = 'ADUN_ATTENDANCE_SALT_v1';
const DEVICE_ID_KEY = 'adun_device_uuid';
const DEVICE_BINDING_KEY = 'adun_device_binding';

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
 * Normalizes matric numbers: trims whitespace, removes repeated slashes/spaces, uppercase
 */
export function normalizeMatric(matric: string): string {
  if (!matric) return '';
  return matric.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Gets or creates a persistent random UUID for this device
 */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      if (typeof crypto.randomUUID === 'function') {
        id = crypto.randomUUID();
      } else {
        id = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      }
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'temp_device_' + Date.now();
  }
}

/**
 * Checks soft device lock:
 * If this device is already bound to another matric number hash, returns false.
 */
export async function checkDeviceBinding(matric: string): Promise<{
  allowed: boolean;
  message?: string;
  isFirstBinding: boolean;
}> {
  const normalized = normalizeMatric(matric);
  const incomingHash = await sha256Hex(normalized + ':' + APP_SALT);

  try {
    const raw = localStorage.getItem(DEVICE_BINDING_KEY);
    if (!raw) {
      return { allowed: true, isFirstBinding: true };
    }

    const binding = JSON.parse(raw);
    if (binding && binding.matric_hash) {
      if (binding.matric_hash === incomingHash) {
        // Same student on this device
        binding.last_seen_at = new Date().toISOString();
        localStorage.setItem(DEVICE_BINDING_KEY, JSON.stringify(binding));
        return { allowed: true, isFirstBinding: false };
      } else {
        // Bound to a different matric
        return {
          allowed: false,
          isFirstBinding: false,
          message: 'This device is bound to another matric number. Use your original device or contact your lecturer/admin to reset your binding.',
        };
      }
    }
  } catch (e) {
    console.error('Error parsing device binding:', e);
  }

  return { allowed: true, isFirstBinding: true };
}

/**
 * Saves or updates matric binding in localStorage
 */
export async function bindDeviceToMatric(matric: string): Promise<void> {
  const normalized = normalizeMatric(matric);
  const hash = await sha256Hex(normalized + ':' + APP_SALT);
  const deviceId = getOrCreateDeviceId();
  const now = new Date().toISOString();

  const binding = {
    device_id: deviceId,
    matric_hash: hash,
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
 * Generates client idempotency key
 */
export function generateIdempotencyKey(): string {
  return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}
