import { getAttemptState } from './attemptState';

export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const HEARTBEAT_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_HEARTBEAT_RETRIES = 2;
const FAILED_EVENTS_STORAGE_KEY = 'adun_heartbeat_failed_events';

export interface HeartbeatFailedEvent {
  type: 'heartbeat_failed';
  reason: string;
  timestamp: string;
}

export interface HeartbeatStatus {
  active: boolean;
  insideFence: boolean | null;
  sessionEnded: boolean;
  lastHeartbeatAt: string | null;
  failedEventsCount: number;
}

type HeartbeatListener = (status: HeartbeatStatus) => void;

function readStoredFailedEvents(): HeartbeatFailedEvent[] {
  try {
    const raw =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(FAILED_EVENTS_STORAGE_KEY)
        : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredFailedEvents(events: HeartbeatFailedEvent[]): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (events.length === 0) {
      sessionStorage.removeItem(FAILED_EVENTS_STORAGE_KEY);
    } else {
      sessionStorage.setItem(FAILED_EVENTS_STORAGE_KEY, JSON.stringify(events));
    }
  } catch {
    // ignore storage errors
  }
}

async function getQuickCurrentCoordinates(): Promise<{
  latitude: number;
  longitude: number;
  accuracy_m: number;
} | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.geolocation ||
    typeof navigator.geolocation.getCurrentPosition !== 'function'
  ) {
    return null;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy,
          });
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 4500 }
      );
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export function createHeartbeatManager() {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let expiresAtMs: number | null = null;
  let inFlight = false;
  let failedEvents: HeartbeatFailedEvent[] = readStoredFailedEvents();
  const listeners = new Set<HeartbeatListener>();

  let status: HeartbeatStatus = {
    active: false,
    insideFence: null,
    sessionEnded: false,
    lastHeartbeatAt: null,
    failedEventsCount: failedEvents.length,
  };

  const notify = () => {
    const snapshot: HeartbeatStatus = { ...status };
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // ignore listener errors
      }
    });
  };

  const stop = (opts?: { sessionEnded?: boolean }) => {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    expiresAtMs = null;
    status = {
      ...status,
      active: false,
      ...(opts?.sessionEnded ? { sessionEnded: true } : {}),
    };
    notify();
  };

  const recordFailedEvent = (reason: string) => {
    const event: HeartbeatFailedEvent = {
      type: 'heartbeat_failed',
      reason,
      timestamp: new Date().toISOString(),
    };
    failedEvents = [...failedEvents, event];
    writeStoredFailedEvents(failedEvents);
    status = {
      ...status,
      failedEventsCount: failedEvents.length,
    };
    notify();
  };

  const sendHeartbeatAttempt = async (
    attemptToken: string,
    coords: { latitude: number; longitude: number; accuracy_m: number } | null
  ): Promise<{ ok: boolean; retriable: boolean; sessionEnded?: boolean; insideFence?: boolean; reason?: string }> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), HEARTBEAT_REQUEST_TIMEOUT_MS)
      : null;

    try {
      const res = await fetch('/api/log-heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Attempt-Token': attemptToken,
        },
        credentials: 'include',
        ...(controller ? { signal: controller.signal } : {}),
        body: JSON.stringify({
          attempt_token: attemptToken,
          ...(coords ? coords : {}),
          ...(failedEvents.length > 0 ? { failed_events: failedEvents } : {}),
        }),
      });

      const json = await res.json().catch(() => ({}));
      const errCode = json?.error || json?.code;

      if (errCode === 'SESSION_ENDED') {
        return { ok: false, retriable: false, sessionEnded: true, reason: 'SESSION_ENDED' };
      }

      if (res.status >= 500) {
        return { ok: false, retriable: true, reason: `HTTP_${res.status}` };
      }

      if (!res.ok) {
        return {
          ok: false,
          retriable: false,
          reason: errCode || `HTTP_${res.status}`,
        };
      }

      const insideFence =
        typeof json?.inside_fence === 'boolean' ? json.inside_fence : true;
      return { ok: true, retriable: false, insideFence };
    } catch (err: unknown) {
      const reason =
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'TIMEOUT'
            : err.message || 'NETWORK_ERROR'
          : 'NETWORK_ERROR';
      return { ok: false, retriable: true, reason };
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  };

  const tick = async (): Promise<void> => {
    if (inFlight) return;

    const attempt = getAttemptState();
    const rawExpires = attempt?.expires_at ?? attempt?.session?.expires_at;
    const currentExpiresMs = rawExpires ? Date.parse(rawExpires) : expiresAtMs;

    if (
      !attempt?.attempt_token ||
      currentExpiresMs === null ||
      !Number.isFinite(currentExpiresMs) ||
      Date.now() >= currentExpiresMs
    ) {
      stop();
      return;
    }

    inFlight = true;
    try {
      const liveCoords = await getQuickCurrentCoordinates();
      const fallbackCoords =
        !liveCoords && attempt.location
          ? {
              latitude: attempt.location.latitude,
              longitude: attempt.location.longitude,
              accuracy_m: attempt.location.accuracy_m,
            }
          : null;
      const coords = liveCoords ?? fallbackCoords;

      let lastReason = 'NETWORK_ERROR';
      for (let attemptIdx = 0; attemptIdx <= MAX_HEARTBEAT_RETRIES; attemptIdx++) {
        const result = await sendHeartbeatAttempt(attempt.attempt_token, coords);

        if (result.sessionEnded) {
          stop({ sessionEnded: true });
          return;
        }

        if (result.ok) {
          failedEvents = [];
          writeStoredFailedEvents([]);
          status = {
            ...status,
            insideFence: result.insideFence ?? true,
            lastHeartbeatAt: new Date().toISOString(),
            failedEventsCount: 0,
          };
          notify();
          return;
        }

        lastReason = result.reason || lastReason;
        if (!result.retriable) {
          break;
        }
      }

      // User Decision A2: Do not penalize isolated network failures; queue failed_events for next successful heartbeat
      recordFailedEvent(lastReason);
    } finally {
      inFlight = false;
    }
  };

  const start = (): boolean => {
    const attempt = getAttemptState();
    const rawExpires = attempt?.expires_at ?? attempt?.session?.expires_at;
    if (!attempt?.attempt_token || !rawExpires) {
      return false;
    }

    const parsedExpiresMs = Date.parse(rawExpires);
    if (!Number.isFinite(parsedExpiresMs) || Date.now() >= parsedExpiresMs) {
      stop();
      return false;
    }

    if (intervalId !== null) {
      expiresAtMs = parsedExpiresMs;
      return true;
    }

    expiresAtMs = parsedExpiresMs;
    status = {
      ...status,
      active: true,
      sessionEnded: false,
    };
    notify();

    intervalId = setInterval(() => {
      void tick();
    }, HEARTBEAT_INTERVAL_MS);

    return true;
  };

  const subscribe = (listener: HeartbeatListener): (() => void) => {
    listeners.add(listener);
    listener({ ...status });
    return () => {
      listeners.delete(listener);
    };
  };

  const getStatus = (): HeartbeatStatus => ({ ...status });

  const reset = () => {
    stop();
    failedEvents = [];
    writeStoredFailedEvents([]);
    status = {
      active: false,
      insideFence: null,
      sessionEnded: false,
      lastHeartbeatAt: null,
      failedEventsCount: 0,
    };
    notify();
  };

  return {
    start,
    stop,
    tick,
    subscribe,
    getStatus,
    reset,
  };
}

export const heartbeatManager = createHeartbeatManager();
