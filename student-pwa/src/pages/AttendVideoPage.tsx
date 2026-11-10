import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight, Loader2, Info } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptReceipt, clearAttemptState } from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';
import { generateDeviceFingerprint } from '../lib/deviceFingerprint';
import { getOrCreateDeviceId } from '../lib/crypto';
import type { AttendanceReceipt } from '../types';

export const AttendVideoPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step Guards (Fixes QA-06)
  useEffect(() => {
    if (!attempt || !attempt.attempt_id || !attempt.attempt_token) {
      clearAttemptState();
      navigate('/', { replace: true });
      return;
    }

    if (!attempt.student) {
      navigate('/attend/identity', { replace: true });
      return;
    }

    if (Boolean(attempt.session?.location_enabled) && !attempt.location) {
      navigate('/attend/location', { replace: true });
      return;
    }

    if (!attempt.selfie_path) {
      navigate('/attend/selfie', { replace: true });
      return;
    }
  }, [attempt, navigate]);

  const handleSubmit = async () => {
    if (submitting || !attempt || !attempt.attempt_token || !attempt.selfie_path) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      // 1. Stable idempotency key from attemptState (Fixes QA-11)
      const idempotencyKey = attempt.idempotency_key;

      // 2. Resolve deterministic fingerprint hash
      let fpHash = attempt.fingerprint_hash;
      if (!fpHash) {
        const fp = await generateDeviceFingerprint();
        if (fp.success && fp.hash) {
          fpHash = fp.hash;
        } else {
          clearAttemptState();
          navigate('/block/contact-admin?ref=BIND-200', { replace: true });
          return;
        }
      }

      const deviceId = getOrCreateDeviceId();

      // 3. Clean device_info payload: NEVER include selfie_data_url (Fixes PERF-07)
      const deviceInfo = {
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        submittedAt: new Date().toISOString(),
        fingerprintHash: fpHash,
        local_device_id: deviceId,
        incognito_signal: Boolean(attempt.is_incognito),
      };

      // 4. Submit attendance via Edge Function
      const result = await attendanceService.submitAttendance({
        attemptToken: attempt.attempt_token,
        selfiePath: attempt.selfie_path,
        fingerprintHash: fpHash,
        deviceInfo,
        idempotencyKey,
      });

      // Construct Receipt
      const receipt: AttendanceReceipt = {
        receipt_id: result.receipt_id,
        status: result.status || 'present',
        signed_at: result.signed_at || new Date().toISOString(),
        course_code: attempt.session?.course_code || 'ADUN COURSE',
        course_title: attempt.session?.course_title || 'Academic Lecture',
        student_name: `${attempt.student?.surname}, ${attempt.student?.first_name}`,
        matric_no: attempt.student?.matric_no || '',
        selfie_preview: attempt.selfie_data_url,
      };

      updateAttemptReceipt(receipt);

      // Advance to final confirmation screen
      navigate('/attend/confirmation');
    } catch (err: unknown) {
      console.error('Submission error:', err);

      if (!navigator.onLine) {
        navigate('/offline', { replace: true });
        return;
      }

      if (err instanceof ApiError) {
        const errCode = err.code;
        const ref = (err.data?.reference_code as string) || '';
        const refEncoded = encodeURIComponent(ref);

        if (err.status === 409 && errCode === 'ALREADY_SIGNED') {
          // If already signed, check if receipt exists
          if (err.data?.receipt_id) {
            const receipt: AttendanceReceipt = {
              receipt_id: err.data.receipt_id,
              status: err.data.status || 'present',
              signed_at: err.data.signed_at || new Date().toISOString(),
              course_code: attempt.session?.course_code || 'ADUN COURSE',
              course_title: attempt.session?.course_title || 'Academic Lecture',
              student_name: `${attempt.student?.surname}, ${attempt.student?.first_name}`,
              matric_no: attempt.student?.matric_no || '',
              selfie_preview: attempt.selfie_data_url,
            };
            updateAttemptReceipt(receipt);
            navigate('/attend/confirmation');
            return;
          }
          clearAttemptState();
          navigate('/already-signed', { replace: true });
          return;
        }

        if (errCode === 'SESSION_EXPIRED' || errCode === 'ATTEMPT_EXPIRED' || err.status === 410) {
          clearAttemptState();
          navigate('/expired', { replace: true });
          return;
        }

        if (errCode === 'SESSION_CLOSED') {
          clearAttemptState();
          navigate('/closed', { replace: true });
          return;
        }

        // Handle BIND reference codes
        if (ref.startsWith('BIND-203') || errCode === 'SHARED_DEVICE') {
          clearAttemptState();
          navigate(`/block/shared-device?ref=${refEncoded}`, { replace: true });
          return;
        }

        if (ref.startsWith('BIND-201') || errCode === 'NEW_DEVICE') {
          clearAttemptState();
          navigate(`/block/new-device?ref=${refEncoded}`, { replace: true });
          return;
        }

        if (ref.startsWith('BIND-202') || errCode === 'DEVICE_IN_USE') {
          clearAttemptState();
          navigate(`/block/device-in-use?ref=${refEncoded}`, { replace: true });
          return;
        }

        if (ref.startsWith('BIND-205') || errCode === 'OPEN_NORMAL_BROWSER') {
          clearAttemptState();
          navigate(`/block/incognito?ref=${refEncoded}`, { replace: true });
          return;
        }

        if (ref.startsWith('BIND-204') || errCode === 'CONTACT_ADMIN') {
          clearAttemptState();
          navigate(`/block/contact-admin?ref=${refEncoded}`, { replace: true });
          return;
        }

        setSubmitError(err.message || 'Submission failed. Please tap retry.');
      } else {
        setSubmitError('Network failure connecting to attendance server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center overflow-x-hidden">
      {/* Header with Step 4 (Submit) */}
      <Header
        currentStep="submit"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-3 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col min-w-0">
        {/* Video Card */}
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-200/80 mb-3 sm:mb-4 min-w-0">
          <div className="text-center mb-3">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Course Lecture Guidelines
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Review institutional attendance & classroom ethics
            </p>
          </div>

          {/* Interactive HTML5 Video / SVG Animation Player (Fixes QA-10) */}
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 shadow-inner flex items-center justify-center">
            {/* Animated SVG Guidelines Illustration */}
            <svg
              className="w-full h-full"
              viewBox="0 0 320 180"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#1E40AF" />
                  <stop offset="50%" stopColor="#0F172A" />
                  <stop offset="100%" stopColor="#1E3A8A" />
                </linearGradient>
                <linearGradient id="glowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.2" />
                </linearGradient>
              </defs>
              <rect width="320" height="180" fill="url(#bgGrad)" />

              {/* Pulsing rings */}
              <circle cx="160" cy="80" r="45" fill="none" stroke="rgba(147, 197, 253, 0.2)" strokeWidth="2">
                <animate attributeName="r" values="35;50;35" dur="4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0.2;0.6" dur="4s" repeatCount="indefinite" />
              </circle>

              <circle cx="160" cy="80" r="30" fill="url(#glowGrad)" />

              {/* Academic emblem icon */}
              <path
                d="M160 65 L178 74 L160 83 L142 74 Z M147 79 L147 89 Q160 96 173 89 L173 79"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Text label */}
              <text
                x="160"
                y="135"
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="12"
                fontWeight="bold"
                letterSpacing="0.5"
              >
                ADUN ACADEMIC INTEGRITY
              </text>
              <text
                x="160"
                y="152"
                textAnchor="middle"
                fill="#93C5FD"
                fontSize="9"
                fontWeight="500"
              >
                Official Verification Policy
              </text>
            </svg>
          </div>

          <div className="mt-3 sm:mt-3.5 flex items-start gap-2 bg-blue-50/70 p-3 rounded-xl border border-blue-100 text-xs text-blue-950">
            <Info className="w-4 h-4 text-[#1E40AF] shrink-0 mt-0.5" />
            <p className="leading-snug">
              By confirming, you certify that you are physically in attendance and using your own registered personal device.
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-800">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold break-words">{submitError}</p>
            </div>
          </div>
        )}

        {/* SUBMIT BUTTON IS ALWAYS ENABLED (Fixes QA-10, G3) */}
        <div className="mt-auto pt-2 pb-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full min-h-[48px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-300 text-white font-semibold text-xs py-3.5 sm:py-4 px-4 rounded-xl shadow-md transition-all active:scale-[0.99]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Recording verified attendance...</span>
              </>
            ) : (
              <>
                <span>Confirm & Record Attendance</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
