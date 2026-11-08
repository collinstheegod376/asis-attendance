import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { AdunLogo } from '../components/AdunLogo';
import { attendanceApi } from '../lib/supabase';
import { initAttemptState } from '../lib/sessionStorage';
import { detectIncognito } from '../lib/deviceFingerprint';

export const JoinTokenPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Set no-referrer meta
    let meta = document.querySelector('meta[name="referrer"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.appendChild(meta);
    }
    meta.content = 'no-referrer';

    if (!token || !token.trim()) {
      navigate('/invalid', { replace: true });
      return;
    }

    let isMounted = true;

    async function runGate0AndValidate() {
      // GATE 0: Incognito check
      try {
        const isPrivate = await detectIncognito();
        if (isPrivate && isMounted) {
          navigate('/block/incognito?ref=BIND-205', { replace: true });
          return;
        }
      } catch {
        // Continue to server token validation
      }

      try {
        const response: any = await attendanceApi.validateSessionToken(token!.trim());

        if (!isMounted) return;

        if (!response || !response.success) {
          const errCode = response?.error;
          switch (errCode) {
            case 'SESSION_EXPIRED':
              navigate('/expired', { replace: true });
              return;
            case 'SESSION_NOT_STARTED':
              navigate('/not-started', { replace: true });
              return;
            case 'SESSION_CLOSED':
            case 'COURSE_ARCHIVED':
              navigate('/closed', { replace: true });
              return;
            case 'INVALID_TOKEN':
            default:
              navigate('/invalid', { replace: true });
              return;
          }
        }

        // Token is valid! Initialize attempt in sessionStorage
        if (response.attempt_id && response.attempt_token && response.session) {
          initAttemptState(
            token!.trim(),
            response.attempt_id,
            response.attempt_token,
            response.session
          );

          // Proceed to step 1
          navigate('/attend/identity', { replace: true });
        } else {
          navigate('/invalid', { replace: true });
        }
      } catch (err: any) {
        console.error('Validation error:', err);
        if (isMounted) {
          if (!navigator.onLine) {
            navigate('/offline', { replace: true });
          } else {
            setErrorMsg(err.message || 'Unable to connect to university server.');
          }
        }
      }
    }

    runGate0AndValidate();

    return () => {
      isMounted = false;
    };
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-full max-w-sm flex flex-col items-center bg-white rounded-3xl p-8 shadow-sm border border-slate-200/80">
        <AdunLogo size={68} showText />

        <div className="mt-8 mb-4">
          <RefreshCw className="w-8 h-8 text-[#1E40AF] animate-spin mx-auto" />
        </div>

        <h3 className="text-base font-bold text-slate-900 mb-1">
          Validating Lecture Session
        </h3>
        <p className="text-xs text-slate-500 max-w-[220px]">
          Verifying security token with ADUN attendance server...
        </p>

        {errorMsg && (
          <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded-2xl text-left flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-xs text-red-800">
              <p className="font-semibold">{errorMsg}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 text-[#1E40AF] font-bold underline"
              >
                Retry verification
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
