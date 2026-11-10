import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { attendanceService, ApiError } from '../lib/attendanceService';
import { getAttemptState, initAttemptState, clearAttemptState } from '../lib/attemptState';
import { detectIncognito } from '../lib/deviceFingerprint';

export const JoinTokenPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);
  const validatedRef = useRef(false);

  // Countdown timer for rate limiting
  useEffect(() => {
    if (!rateLimitedUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setRateLimitSeconds(remaining);
      if (remaining <= 0) {
        setRateLimitedUntil(null);
        setErrorMsg(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitedUntil]);

  useEffect(() => {
    // 1. HTTPS Guard (Fixes PERF-17)
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      navigate('/unsupported', { replace: true });
      return;
    }

    // Set no-referrer meta
    let meta = document.querySelector('meta[name="referrer"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.appendChild(meta);
    }
    meta.content = 'no-referrer';

    if (!token || !token.trim()) {
      clearAttemptState();
      navigate('/invalid', { replace: true });
      return;
    }

    // Offline check (Fixes PERF-14)
    if (!navigator.onLine) {
      navigate('/offline', { replace: true });
      return;
    }

    if (validatedRef.current) return;
    validatedRef.current = true;

    async function runGate0AndValidate() {
      // GATE 0: Incognito check
      try {
        const isPrivate = await detectIncognito();
        if (isPrivate) {
          clearAttemptState();
          navigate('/block/incognito?ref=BIND-205', { replace: true });
          return;
        }
      } catch {
        // Continue to server token validation
      }

      try {
        const cleanToken = token!.trim();
        const existingAttempt = getAttemptState();
        // Check if we can reuse existing attempt token (Fixes SEC-22)
        const reuseAttemptToken =
          existingAttempt && existingAttempt.raw_token === cleanToken
            ? existingAttempt.attempt_token
            : undefined;

        const response = await attendanceService.validateSessionToken(cleanToken, reuseAttemptToken);

        // Success: initialize / reuse attempt state in sessionStorage
        initAttemptState(
          cleanToken,
          response.attempt_id,
          response.attempt_token,
          {
            id: response.session_id,
            title: 'ADUN Attendance Session',
            course_code: response.course_id ? `COURSE-${response.course_id.slice(0, 6)}` : 'ADUN LECTURE',
            course_title: 'Academic Lecture Attendance',
            starts_at: new Date().toISOString(),
            expires_at: response.expires_at,
            grace_minutes: 15,
            location_enabled: response.location_enabled,
          },
          existingAttempt?.idempotency_key
        );

        // Proceed directly to identity step
        navigate('/attend/identity', { replace: true });
      } catch (err: unknown) {
        console.error('Validation error:', err);

        if (!navigator.onLine) {
          navigate('/offline', { replace: true });
          return;
        }

        if (err instanceof ApiError) {
          // Rate limit awareness (Fixes SEC-18)
          if (err.status === 429) {
            setRateLimitedUntil(Date.now() + 60000);
            setRateLimitSeconds(60);
            setErrorMsg('Too many attempts. Please wait 60 seconds.');
            return;
          }

          if (err.status === 410 || err.code === 'SESSION_EXPIRED' || err.code === 'ATTEMPT_EXPIRED') {
            clearAttemptState();
            navigate('/expired', { replace: true });
            return;
          }

          if (err.status === 425 || err.code === 'SESSION_NOT_STARTED') {
            clearAttemptState();
            navigate('/not-started', { replace: true });
            return;
          }

          if (err.status === 403 || err.code === 'SESSION_CLOSED' || err.code === 'COURSE_ARCHIVED') {
            clearAttemptState();
            navigate('/closed', { replace: true });
            return;
          }

          if (err.code === 'INVALID_TOKEN' || err.status === 400 || err.status === 404) {
            clearAttemptState();
            navigate('/invalid', { replace: true });
            return;
          }

          setErrorMsg(err.message || 'Unable to validate lecture session.');
        } else {
          setErrorMsg('Unable to connect to university server. Check connection.');
        }
      }
    }

    runGate0AndValidate();
  }, [token, navigate]);

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center p-4 sm:p-6 text-center">
      <div className="w-full max-w-sm flex flex-col items-center bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <AdunLogo size={68} showText />

        <div className="mt-6 sm:mt-8 mb-4">
          <RefreshCw className="w-8 h-8 text-[#1E40AF] animate-spin mx-auto" />
        </div>

        <h3 className="text-base font-bold text-slate-900 mb-1">
          Validating Lecture Session
        </h3>
        <p className="text-xs text-slate-500 max-w-[240px]">
          Verifying security token with ADUN attendance server...
        </p>

        {errorMsg && (
          <div className="mt-6 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-left flex items-start gap-2.5 w-full">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800 flex-1 min-w-0">
              <p className="font-semibold break-words">{errorMsg}</p>
              {rateLimitedUntil ? (
                <p className="mt-1 text-slate-600 font-medium">
                  Retry available in{' '}
                  <strong className="text-red-900 font-extrabold">{rateLimitSeconds}s</strong>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-2.5 inline-block text-[#1E40AF] font-bold underline active:opacity-75 py-1"
                >
                  Retry verification
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
