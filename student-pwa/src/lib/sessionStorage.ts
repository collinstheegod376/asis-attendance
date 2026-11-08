import type { AttemptSessionState, AttendanceReceipt, SessionData, StudentData } from '../types';

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

export function initAttemptState(rawToken: string, attemptId: string, attemptToken: string, session: SessionData): AttemptSessionState {
  const state: AttemptSessionState = {
    attempt_id: attemptId,
    attempt_token: attemptToken,
    raw_token: rawToken,
    session,
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

export function updateAttemptSelfie(selfieDataUrl: string, selfiePath?: string): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    selfie_data_url: selfieDataUrl,
    selfie_path: selfiePath,
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

export function updateAttemptVideoWatched(watched: boolean): AttemptSessionState | null {
  const current = getAttemptState();
  if (!current) return null;
  const updated: AttemptSessionState = {
    ...current,
    video_watched: watched,
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
