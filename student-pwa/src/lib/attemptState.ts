import type { AttemptSessionState, AttendanceReceipt, SessionData, StudentData, LivenessProof } from '../types';
import { generateIdempotencyKey } from './crypto';

const ATTEMPT_KEY = 'adun_attempt_state';

export function getAttemptState(): AttemptSessionState | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AttemptSessionState;
  } catch {
    return null;
  }
}

export function saveAttemptState(state: AttemptSessionState): void {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save attempt state to sessionStorage:', e);
  }
}

export function initAttemptState(
  rawToken: string,
  attemptId: string,
  attemptToken: string,
  session: SessionData,
  existingIdempotencyKey?: string
): AttemptSessionState {
  const current = getAttemptState();
  const idempotencyKey =
    existingIdempotencyKey ||
    (current?.attempt_id === attemptId && current?.idempotency_key ? current.idempotency_key : generateIdempotencyKey());

  const state: AttemptSessionState = {
    attempt_id: attemptId,
    attempt_token: attemptToken,
    raw_token: rawToken,
    session_id: session.id,
    session,
    idempotency_key: idempotencyKey,
  };
  saveAttemptState(state);
  return state;
}

export function updateAttemptStudent(student: StudentData): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    student,
  };
  saveAttemptState(updated);
  return updated;
}

export function updateAttemptLocation(location: {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  verified_at: string;
  inside_boundary?: boolean;
}): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    location,
  };
  saveAttemptState(updated);
  return updated;
}

export function clearAttemptLocation(): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const { location: _removed, ...rest } = current;
  saveAttemptState(rest);
  return rest;
}

/**
 * Strict step guard helper: when location verification is enabled on the session,
 * the student MUST have a server-confirmed `location.inside_boundary === true`.
 */
export function isLocationRequirementSatisfied(attempt: AttemptSessionState | null): boolean {
  if (!attempt) return false;
  if (attempt.session?.location_enabled !== true) return true;
  return attempt.location?.inside_boundary === true;
}

export function updateAttemptSelfie(
  selfieDataUrl: string,
  selfiePath?: string,
  livenessProof?: LivenessProof
): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    selfie_data_url: selfieDataUrl,
    selfie_path: selfiePath,
    ...(livenessProof ? { liveness_proof: livenessProof } : {}),
  };
  saveAttemptState(updated);
  return updated;
}

export function updateAttemptFingerprint(fingerprintHash: string, isIncognito: boolean): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    fingerprint_hash: fingerprintHash,
    is_incognito: isIncognito,
  };
  saveAttemptState(updated);
  return updated;
}

export function updateAttemptReceipt(receipt: AttendanceReceipt): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    receipt,
  };
  saveAttemptState(updated);
  return updated;
}

export function clearAttemptState(): void {
  try {
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {}
}
