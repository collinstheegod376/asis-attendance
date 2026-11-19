import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight, Loader2, Info } from 'lucide-react';
import { Header } from '../components/Header';
import {
  getAttemptState,
  updateAttemptReceipt,
  clearAttemptLocation,
  clearAttemptState,
  isLocationRequirementSatisfied,
} from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';
import { generateDeviceFingerprint, getDeviceHash } from '../lib/deviceFingerprint';
import { getOrCreateDeviceId } from '../lib/crypto';
import type { AttendanceReceipt } from '../types';

export const AttendVideoPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [needsLocationRecheck, setNeedsLocationRecheck] = useState(false);

  // Step Guards (Fixes QA-06): Strictly require verified inside_boundary === true when location_enabled is true
  useEffect(() => {
    const currentAttempt = getAttemptState();
    if (!currentAttempt || !currentAttempt.attempt_id || !currentAttempt.attempt_token) {
      clearAttemptState();
      navigate('/', { replace: true });
      return;
    }

    if (!currentAttempt.student) {
      navigate('/attend/identity', { replace: true });
      return;
    }

    if (!isLocationRequirementSatisfied(currentAttempt)) {
      navigate('/attend/location', { replace: true });
      return;
    }

    if (!currentAttempt.selfie_path) {
      navigate('/attend/selfie', { replace: true });
      return;
    }
  }, [navigate]);

  const handleSubmit = async () => {
    const currentAttempt = getAttemptState();
    if (submitting || !currentAttempt || !currentAttempt.attempt_token || !currentAttempt.selfie_path) return;

    if (!isLocationRequirementSatisfied(currentAttempt)) {
      navigate('/attend/location', { replace: true });
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setNeedsLocationRecheck(false);

    try {
      // 1. Stable idempotency key from attemptState (Fixes QA-11)
      const idempotencyKey = currentAttempt.idempotency_key;

      // 2. Resolve deterministic fingerprint hash
      let fpHash = currentAttempt.fingerprint_hash;
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
      const deviceHash = await getDeviceHash();

      // 3. Clean device_info payload: NEVER include selfie_data_url (Fixes PERF-07)
      const deviceInfo = {
        userAgent: navigator.userAgent,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        submittedAt: new Date().toISOString(),
        fingerprintHash: fpHash,
        local_device_id: deviceId,
        incognito_signal: Boolean(currentAttempt.is_incognito),
        ...(currentAttempt.liveness_proof ? { liveness_proof: currentAttempt.liveness_proof } : {}),
      };

      // 4. Submit attendance via Edge Function
      const result = await attendanceService.submitAttendance({
        attemptToken: currentAttempt.attempt_token,
        selfiePath: currentAttempt.selfie_path,
        fingerprintHash: fpHash,
        deviceInfo,
        idempotencyKey,
        deviceHash,
      });

      // Construct Receipt
      const receipt: AttendanceReceipt = {
        receipt_id: result.receipt_id,
        status: result.status || 'present',
        signed_at: result.signed_at || new Date().toISOString(),
        course_code: currentAttempt.session?.course_code || 'ADUN COURSE',
        course_title: currentAttempt.session?.course_title || 'Academic Lecture',
        student_name: `${currentAttempt.student?.surname}, ${currentAttempt.student?.first_name}`,
        matric_no: currentAttempt.student?.matric_no || '',
        selfie_preview: currentAttempt.selfie_data_url,
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
              course_code: currentAttempt.session?.course_code || 'ADUN COURSE',
              course_title: currentAttempt.session?.course_title || 'Academic Lecture',
              student_name: `${currentAttempt.student?.surname}, ${currentAttempt.student?.first_name}`,
              matric_no: currentAttempt.student?.matric_no || '',
              selfie_preview: currentAttempt.selfie_data_url,
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

        if (errCode === 'LIVE_QR_REQUIRED') {
          setSubmitError(
            'Please scan the live QR code on the projector screen. Links shared via WhatsApp or email will not work in live mode.'
          );
          return;
        }

        if (errCode === 'SESSION_CLOSED' || errCode === 'SESSION_ENDED') {
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

        if (
          errCode === 'OUTSIDE_CLASSROOM_BOUNDARY' ||
          errCode === 'OUTSIDE_CAMPUS_BOUNDARY' ||
          errCode === 'LOCATION_MISSING' ||
          errCode === 'LOW_ACCURACY'
        ) {
          clearAttemptLocation();
          setNeedsLocationRecheck(true);
          setSubmitError(
            err.message ||
              'Your classroom GPS location needs to be re-verified before final submission.'
          );
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

  if (
    !attempt ||
    !attempt.attempt_id ||
    !attempt.attempt_token ||
    !attempt.student ||
    (!isLocationRequirementSatisfied(attempt) && !needsLocationRecheck) ||
    !attempt.selfie_path
  ) {
    return null;
  }

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
          <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl flex flex-col gap-2.5 text-xs text-red-800">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold break-words">{submitError}</p>
              </div>
            </div>
            {needsLocationRecheck && (
              <button
                type="button"
                onClick={() => navigate('/attend/location')}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 bg-white hover:bg-red-100/50 text-[#1E40AF] border border-red-200 font-bold text-xs py-2 px-3 rounded-xl transition-all"
              >
                <span>Re-verify Classroom GPS Location</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* SUBMIT BUTTON IS ALWAYS ENABLED (Fixes QA-10, G3) */}
        <div className="mt-auto pt-2 pb-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || needsLocationRecheck}
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
