import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, CheckCircle2, ShieldAlert, ArrowRight, Loader2, Info } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptVideoWatched, updateAttemptReceipt } from '../lib/sessionStorage';
import { attendanceApi } from '../lib/supabase';
import { generateIdempotencyKey, getOrCreateDeviceId } from '../lib/crypto';
import { generateDeviceFingerprint } from '../lib/deviceFingerprint';
import type { AttendanceReceipt } from '../types';

export const AttendVideoPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [hasWatched, setHasWatched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!attempt || !attempt.student || !attempt.selfie_data_url) {
      navigate('/attend/identity', { replace: true });
    }
  }, [attempt, navigate]);

  const handleSubmit = async () => {
    if (!hasWatched || submitting || !attempt) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      updateAttemptVideoWatched(true);

      const idempotencyKey = generateIdempotencyKey();
      const selfiePath = attempt.selfie_path || `selfies/${attempt.session.id}/${attempt.student?.id}/${attempt.attempt_id}.jpg`;
      const deviceId = getOrCreateDeviceId();

      // Gate 4: Ensure deterministic fingerprint_hash is included
      let fpHash = attempt.fingerprint_hash;
      if (!fpHash) {
        const fp = await generateDeviceFingerprint();
        if (fp.success && fp.hash) {
          fpHash = fp.hash;
        } else {
          // Fail-closed policy
          navigate(
            `/block/contact-admin?ref=BIND-200&reason=${encodeURIComponent(
              'Device fingerprint generation failed or was blocked by browser privacy settings.'
            )}`
          );
          return;
        }
      }

      const deviceInfo = {
        userAgent: navigator.userAgent,
        screen: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language,
        submittedAt: new Date().toISOString(),
        fingerprint_hash: fpHash,
        device_id: deviceId,
        selfie_data_url: attempt.selfie_data_url,
      };

      const result: any = await attendanceApi.submitAttendance(
        attempt.attempt_id,
        attempt.attempt_token,
        selfiePath,
        deviceInfo,
        idempotencyKey
      );

      if (!result || !result.success) {
        const err = result?.error;
        const ref = result?.reference_code;
        const msg = (result?.message || result?.reason || '') as string;

        // Gate 4 Anti-Proxy / Same-session multi-student check (Option 2 Spec)
        if (ref === 'BIND-203' || err === 'SHARED_DEVICE' || msg.includes('already been used for another student')) {
          navigate('/block/shared-device?ref=BIND-203');
          return;
        }

        if (ref === 'BIND-201' || err === 'NEW_DEVICE' || msg.includes('New device detected')) {
          navigate('/block/new-device?ref=BIND-201');
          return;
        }

        if (ref === 'BIND-202' || err === 'DEVICE_IN_USE' || msg.includes('registered to another student')) {
          navigate('/block/device-in-use?ref=BIND-202');
          return;
        }

        if (ref === 'BIND-205' || err === 'OPEN_NORMAL_BROWSER' || msg.includes('Incognito')) {
          navigate('/block/incognito?ref=BIND-205');
          return;
        }

        if (ref === 'BIND-204' || err === 'CONTACT_ADMIN') {
          navigate('/block/contact-admin?ref=BIND-204');
          return;
        }

        if (err === 'ALREADY_SIGNED') {
          navigate('/already-signed');
          return;
        } else if (err === 'SESSION_EXPIRED' || err === 'ATTEMPT_EXPIRED') {
          navigate('/expired');
          return;
        } else {
          setSubmitError(result?.message || 'Attendance submission failed. Please try again.');
          setSubmitting(false);
          return;
        }
      }

      // Successful submission
      const receipt: AttendanceReceipt = {
        receipt_id: result.receipt_id || `ADUN-${Date.now().toString(36).toUpperCase()}`,
        status: result.status || 'present',
        signed_at: result.signed_at || new Date().toISOString(),
        course_code: result.course_code || attempt.session.course_code,
        course_title: result.course_title || attempt.session.course_title,
        student_name: result.student_name || `${attempt.student?.surname}, ${attempt.student?.first_name}`,
        matric_no: result.matric_no || attempt.student?.matric_no || '',
        selfie_preview: attempt.selfie_data_url,
      };

      updateAttemptReceipt(receipt);

      // Advance to final confirmation receipt screen
      navigate('/attend/confirmation');
    } catch (err: any) {
      console.error('Submission error:', err);
      if (!navigator.onLine) {
        navigate('/offline');
      } else {
        setSubmitError(err.message || 'Network error submitting attendance.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center">
      {/* Header with Step 3 (Submit) */}
      <Header
        currentStep="submit"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-4 py-3 flex-1 flex flex-col">
        {/* Video Player Card */}
        <div className="w-full bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 mb-4">
          <div className="text-center mb-3">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Course Lecture Guidelines
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Review institutional attendance & classroom ethics
            </p>
          </div>

          {/* Video Mock/HTML5 Player */}
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 shadow-inner flex items-center justify-center">
            {/* Visual Instructional Poster */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#1E40AF] via-slate-900 to-blue-900 flex flex-col items-center justify-center p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-blue-600/80 text-white flex items-center justify-center mb-2 shadow-lg ring-4 ring-white/10">
                <Play className="w-5 h-5 ml-0.5 fill-white" />
              </div>
              <p className="text-xs font-bold text-white tracking-wide">
                ADUN Academic Ethics Brief
              </p>
              <p className="text-[10px] text-blue-200/80 mt-0.5">
                Attendance Policies & Student Code of Conduct
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-start gap-2 bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-950">
            <Info className="w-4 h-4 text-[#1E40AF] shrink-0 mt-0.5" />
            <span>
              By signing in, you affirm your active participation in this lecture session under Admiralty University of Nigeria academic regulations.
            </span>
          </div>

          {/* Confirmation Checkbox */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasWatched}
                onChange={(e) => setHasWatched(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded text-[#1E40AF] focus:ring-[#1E40AF] border-slate-300"
              />
              <span className="text-xs font-semibold text-slate-700 leading-snug">
                I have watched and understand the lecture attendance instruction
              </span>
            </label>
          </div>
        </div>

        {/* Error Banner */}
        {submitError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-800 mb-4 animate-shake">
            <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span className="flex-1 font-medium">{submitError}</span>
          </div>
        )}

        {/* Submit Attendance CTA */}
        <div className="mt-auto pb-4">
          <button
            onClick={handleSubmit}
            disabled={!hasWatched || submitting}
            type="button"
            className="w-full flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm py-3.5 px-4 rounded-2xl shadow-md transition-all active:scale-[0.99]"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                Recording your attendance...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirm & Record Attendance
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
