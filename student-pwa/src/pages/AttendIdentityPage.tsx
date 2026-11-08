import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, UserCheck, AlertCircle, ArrowRight, Edit3, Loader2 } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptStudent, updateAttemptFingerprint } from '../lib/sessionStorage';
import { normalizeMatric, checkDeviceBinding, bindDeviceToMatric, getOrCreateDeviceId } from '../lib/crypto';
import { generateDeviceFingerprint, detectIncognito } from '../lib/deviceFingerprint';
import { attendanceApi } from '../lib/supabase';
import type { StudentData } from '../types';

export const AttendIdentityPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [matricInput, setMatricInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [foundStudent, setFoundStudent] = useState<StudentData | null>(null);
  const [fingerprintHash, setFingerprintHash] = useState<string>('');
  const [isIncognitoState, setIsIncognitoState] = useState<boolean>(false);

  // Guard & Gate 0 / Client Device Fingerprint Initialization
  useEffect(() => {
    if (!attempt || !attempt.attempt_id || !attempt.attempt_token) {
      navigate('/', { replace: true });
      return;
    }

    if (attempt.student) {
      setFoundStudent(attempt.student);
      setMatricInput(attempt.student.matric_no);
    }

    let active = true;

    async function initSecurityGates() {
      // Gate 0: Incognito detection
      const incognito = await detectIncognito();
      if (!active) return;
      setIsIncognitoState(incognito);

      if (incognito) {
        navigate('/block/incognito?ref=BIND-205', { replace: true });
        return;
      }

      // Option 2 Device Fingerprinting (Fail-closed)
      const fp = await generateDeviceFingerprint();
      if (!active) return;

      if (!fp.success || !fp.hash) {
        // Fail-closed to BIND-200. Never silently allow!
        navigate(
          `/block/contact-admin?ref=BIND-200&reason=${encodeURIComponent(
            'Device fingerprint generation failed or was blocked by browser privacy settings.'
          )}`,
          { replace: true }
        );
        return;
      }

      setFingerprintHash(fp.hash);
      updateAttemptFingerprint(fp.hash, incognito);
    }

    initSecurityGates();

    return () => {
      active = false;
    };
  }, [attempt, navigate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = normalizeMatric(e.target.value);
    setMatricInput(val);
    setErrorBanner(null);
  };

  const handleLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!matricInput.trim() || loading || !attempt) return;

    setErrorBanner(null);
    setLoading(true);

    try {
      const cleanMatric = normalizeMatric(matricInput);

      // Gate 0 Re-check before lookup
      if (isIncognitoState) {
        navigate('/block/incognito?ref=BIND-205');
        return;
      }

      // Fail-closed if fingerprint hash is missing
      let activeFpHash = fingerprintHash;
      if (!activeFpHash) {
        const fp = await generateDeviceFingerprint();
        if (!fp.success || !fp.hash) {
          navigate(
            `/block/contact-admin?ref=BIND-200&reason=${encodeURIComponent(
              'Device fingerprint generation failed or was blocked by browser privacy settings.'
            )}`
          );
          return;
        }
        activeFpHash = fp.hash;
        setFingerprintHash(fp.hash);
        updateAttemptFingerprint(fp.hash, isIncognitoState);
      }

      // Gate 1b: Soft client localStorage device check
      const softCheck = await checkDeviceBinding(cleanMatric);
      if (!softCheck.allowed) {
        setErrorBanner(softCheck.message || 'This device is bound to another student.');
        setLoading(false);
        return;
      }

      // Call backend matric lookup
      const deviceId = getOrCreateDeviceId();
      const response: any = await attendanceApi.lookupMatric(
        attempt.attempt_id,
        attempt.attempt_token,
        cleanMatric,
        deviceId
      );

      if (!response || !response.success) {
        const err = response?.error;
        if (err === 'NOT_ON_ROSTER' || err === 'STUDENT_NOT_FOUND') {
          navigate('/not-enrolled');
          return;
        } else if (err === 'ALREADY_SIGNED') {
          if (response.student) {
            updateAttemptStudent(response.student);
          }
          navigate('/already-signed');
          return;
        } else if (err === 'DEVICE_BOUND_TO_ANOTHER_MATRIC') {
          navigate('/block/device-in-use?ref=BIND-202');
          return;
        } else if (err === 'SESSION_EXPIRED' || err === 'ATTEMPT_EXPIRED') {
          navigate('/expired');
          return;
        } else {
          setErrorBanner(response?.message || 'Matric lookup failed. Please check the number.');
          setLoading(false);
          return;
        }
      }

      // Student record found
      const student: StudentData = response.student;

      // Gate 1: Strict Server-Side Device Verification Check
      const deviceCheck = await attendanceApi.checkDevice(
        student.id,
        activeFpHash,
        deviceId,
        isIncognitoState
      );

      // Handle Device Check Results based on Option 2 Spec
      if (deviceCheck.action === 'OPEN_NORMAL_BROWSER' || deviceCheck.reference_code === 'BIND-205') {
        navigate('/block/incognito?ref=BIND-205');
        return;
      }

      if (
        deviceCheck.action === 'NEW_DEVICE' ||
        deviceCheck.reference_code === 'BIND-201' ||
        (deviceCheck.reason && deviceCheck.reason.includes('New device detected'))
      ) {
        navigate('/block/new-device?ref=BIND-201');
        return;
      }

      if (
        deviceCheck.action === 'DEVICE_IN_USE' ||
        deviceCheck.reference_code === 'BIND-202' ||
        (deviceCheck.reason && deviceCheck.reason.includes('registered to another student'))
      ) {
        navigate('/block/device-in-use?ref=BIND-202');
        return;
      }

      if (
        deviceCheck.action === 'SHARED_DEVICE' ||
        deviceCheck.reference_code === 'BIND-203' ||
        (deviceCheck.reason && deviceCheck.reason.includes('already been used'))
      ) {
        navigate('/block/shared-device?ref=BIND-203');
        return;
      }

      if (
        deviceCheck.action === 'CONTACT_ADMIN' ||
        deviceCheck.reference_code === 'BIND-204' ||
        (deviceCheck.success === false && !deviceCheck.action)
      ) {
        const ref = deviceCheck.reference_code || 'BIND-204';
        navigate(`/block/contact-admin?ref=${ref}`);
        return;
      }

      // Verification Passed: Allow and bind
      setFoundStudent(student);
      updateAttemptStudent(student);
      updateAttemptFingerprint(activeFpHash, isIncognitoState);
      await bindDeviceToMatric(cleanMatric);
    } catch (err: any) {
      console.error('Lookup exception:', err);
      if (!navigator.onLine) {
        navigate('/offline');
      } else {
        setErrorBanner(err.message || 'Server error verifying student.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleProceed = () => {
    if (!foundStudent) return;
    navigate('/attend/location');
  };

  const handleManualEdit = () => {
    setFoundStudent(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center">
      {/* Top Header with Stepper */}
      <Header
        currentStep="identity"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-4 py-3 flex-1 flex flex-col">
        {/* Matric Input Card */}
        <div className="w-full bg-white rounded-3xl p-5 shadow-sm border border-slate-200/80 mb-4">
          <div className="mb-3 text-center">
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Enter your Student ID
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Type your matriculation number to get started
            </p>
          </div>

          <form onSubmit={handleLookup} className="space-y-3">
            <div>
              <div className="relative">
                <input
                  type="text"
                  autoFocus
                  disabled={loading || !!foundStudent}
                  value={matricInput}
                  onChange={handleInputChange}
                  placeholder="e.g. ADUN/FS/COM/25/001"
                  className="w-full text-center text-base sm:text-lg font-mono font-bold tracking-wider py-3.5 px-4 bg-slate-50 border-2 border-slate-200 focus:border-[#1E40AF] focus:bg-white rounded-2xl outline-none transition-all uppercase placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 placeholder:font-normal disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>

              {/* Digit counter */}
              <div className="flex items-center justify-between px-1 mt-1.5 text-[11px] text-slate-400 font-mono">
                <span>Format: ADUN/...</span>
                <span>{matricInput.length} characters</span>
              </div>
            </div>

            {/* Error Banner */}
            {errorBanner && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-800 animate-shake">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span className="flex-1 font-medium">{errorBanner}</span>
              </div>
            )}

            {!foundStudent && (
              <button
                type="submit"
                disabled={loading || matricInput.length < 3}
                className="w-full flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-all active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    Verifying student & device...
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    Verify Student Record
                  </>
                )}
              </button>
            )}
          </form>
        </div>

        {/* STUDENT FOUND Card */}
        {foundStudent && (
          <div className="w-full bg-emerald-50/70 border-2 border-emerald-500/30 rounded-3xl p-5 shadow-xs mb-4 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[11px] font-bold tracking-wide uppercase">
                <CheckCircle2 className="w-3.5 h-3.5" /> Student Verified
              </span>

              <button
                onClick={handleManualEdit}
                type="button"
                className="text-[11px] font-semibold text-slate-600 hover:text-[#1E40AF] inline-flex items-center gap-1 transition-colors"
              >
                <Edit3 className="w-3 h-3" /> Edit
              </button>
            </div>

            <div className="space-y-2 text-left">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Full Name</span>
                <span className="text-sm font-extrabold text-slate-900">
                  {foundStudent.surname.toUpperCase()}, {foundStudent.first_name} {foundStudent.middle_name || ''}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-emerald-200/50">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Programme</span>
                  <span className="text-xs font-semibold text-slate-800">{foundStudent.program}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Level</span>
                  <span className="text-xs font-semibold text-slate-800">{foundStudent.level} Level</span>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-2 text-[11px] text-slate-500 text-center">
              Not you, or details wrong?{' '}
              <button
                onClick={handleManualEdit}
                className="font-bold text-[#1E40AF] underline"
              >
                Edit manually
              </button>
            </div>
          </div>
        )}

        {/* Notice Banner */}
        <div className="w-full bg-blue-50/60 border border-blue-100 rounded-2xl p-3.5 text-xs text-blue-950 mb-5">
          <p className="leading-snug">
            Next, your classroom location and a live selfie will be recorded to verify your physical presence.
          </p>
        </div>

        {/* Continue CTA */}
        {foundStudent && (
          <div className="mt-auto pb-4">
            <button
              onClick={handleProceed}
              type="button"
              className="w-full flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-sm py-3.5 px-4 rounded-2xl shadow-md transition-all active:scale-[0.99]"
            >
              Continue to Location Check
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
