import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UserCheck,
  AlertCircle,
  ArrowRight,
  Edit3,
  Loader2,
  ShieldCheck,
  Smartphone,
  CheckCircle2,
} from 'lucide-react';
import { Header } from '../components/Header';
import {
  getAttemptState,
  updateAttemptStudent,
  updateAttemptFingerprint,
  clearAttemptState,
} from '../lib/attemptState';
import {
  normalizeMatric,
  checkDeviceBinding,
  bindDeviceToMatric,
  getOrCreateDeviceId,
} from '../lib/crypto';
import type { ClientDeviceBindingHint } from '../lib/crypto';
import { generateDeviceFingerprint, detectIncognito } from '../lib/deviceFingerprint';
import { attendanceService, ApiError } from '../lib/attendanceService';
import type { StudentData } from '../types';

export const AttendIdentityPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [matricInput, setMatricInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [foundStudent, setFoundStudent] = useState<StudentData | null>(null);
  const [fingerprintHash, setFingerprintHash] = useState<string>('');
  const [isIncognitoState, setIsIncognitoState] = useState<boolean>(false);
  const [bindingHint, setBindingHint] = useState<ClientDeviceBindingHint | null>(null);

  // Rate-limiting state
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);

  const initializedRef = useRef(false);
  const lastLookedUpMatricRef = useRef<string>('');

  // Rate-limit countdown
  useEffect(() => {
    if (!rateLimitedUntil) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((rateLimitedUntil - Date.now()) / 1000));
      setRateLimitSeconds(remaining);
      if (remaining <= 0) {
        setRateLimitedUntil(null);
        setErrorBanner(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [rateLimitedUntil]);

  // Step Guard & Security Initialization (Runs once on mount)
  useEffect(() => {
    const currentAttempt = getAttemptState();
    if (!currentAttempt || !currentAttempt.attempt_id || !currentAttempt.attempt_token) {
      navigate('/', { replace: true });
      return;
    }

    if (currentAttempt.student && !foundStudent) {
      setFoundStudent(currentAttempt.student);
      setMatricInput(currentAttempt.student.matric_no);
    }

    if (initializedRef.current) return;
    initializedRef.current = true;

    let active = true;

    async function initSecurityGates() {
      // Gate 0: Incognito detection
      const incognito = await detectIncognito();
      if (!active) return;
      setIsIncognitoState(incognito);

      if (incognito) {
        clearAttemptState();
        navigate('/block/incognito?ref=BIND-205', { replace: true });
        return;
      }

      // Device Fingerprinting (Fail-closed)
      const fp = await generateDeviceFingerprint();
      if (!active) return;

      if (!fp.success || !fp.hash) {
        clearAttemptState();
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
  }, [navigate]);

  // Perform matric lookup (Triggered explicitly by Verify button or Enter key)
  const performLookup = useCallback(
    async (matricToQuery?: string) => {
      const currentAttempt = getAttemptState();
      if (!currentAttempt?.attempt_token) {
        navigate('/', { replace: true });
        return;
      }

      const raw = matricToQuery !== undefined ? matricToQuery : matricInput;
      const cleanMatric = normalizeMatric(raw);
      if (!cleanMatric || cleanMatric.length < 5) {
        setErrorBanner('Please enter a valid matriculation number (e.g. ADUN/FS/COM/25/001)');
        return;
      }

      if (lastLookedUpMatricRef.current === cleanMatric && foundStudent) {
        return;
      }

      setErrorBanner(null);
      setLoading(true);

      try {
        const response = await attendanceService.lookupMatric(currentAttempt.attempt_token, cleanMatric);
        lastLookedUpMatricRef.current = cleanMatric;

        // Map to student data
        const student: StudentData = {
          id: response.student_id,
          matric_no: response.matric_no,
          surname: response.full_name.split(' ')[0] || response.full_name,
          first_name: response.full_name.split(' ').slice(1).join(' ') || '',
          middle_name: null,
          program: response.program,
          level: response.level,
        };

        setFoundStudent(student);

        // Check local storage binding UX hint
        const hint = await checkDeviceBinding(cleanMatric);
        setBindingHint(hint);
      } catch (err: unknown) {
        console.error('Lookup error:', err);
        if (err instanceof ApiError) {
          if (err.status === 429) {
            setRateLimitedUntil(Date.now() + 60000);
            setRateLimitSeconds(60);
            setErrorBanner('Too many attempts. Please wait 60 seconds.');
            return;
          }

          if (err.code === 'NOT_ELIGIBLE' || err.status === 404) {
            setErrorBanner(err.message || 'Matriculation number not found in course roster. Please double-check your matric number.');
            return;
          }

          if (err.code === 'ALREADY_SIGNED' || err.status === 409) {
            clearAttemptState();
            navigate('/already-signed', { replace: true });
            return;
          }

          if (err.code === 'ATTEMPT_EXPIRED' || err.status === 410) {
            clearAttemptState();
            navigate('/expired', { replace: true });
            return;
          }

          setErrorBanner(err.message || 'Matric lookup failed. Please check the number.');
        } else {
          setErrorBanner('Could not reach server to verify matric. Check connection.');
        }
      } finally {
        setLoading(false);
      }
    },
    [matricInput, foundStudent, navigate]
  );

  // Pure input change: updates value cleanly without premature background network triggers
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = normalizeMatric(e.target.value);
    setMatricInput(val);
    setErrorBanner(null);
    setFoundStudent(null);
    setBindingHint(null);
  };

  // "Edit" clears the displayed card and allows retyping, NO binding
  const handleEdit = () => {
    setFoundStudent(null);
    setBindingHint(null);
    lastLookedUpMatricRef.current = '';
    setErrorBanner(null);
  };

  // "Continue to Location Check" triggers /api/device-check (FIRST time bind is attempted)
  const handleContinue = async () => {
    const currentAttempt = getAttemptState();
    if (!foundStudent || !currentAttempt?.attempt_token || bindingInProgress) return;

    setBindingInProgress(true);
    setErrorBanner(null);

    try {
      // Re-verify incognito signal
      const isPrivate = isIncognitoState || (await detectIncognito());
      if (isPrivate) {
        clearAttemptState();
        navigate('/block/incognito?ref=BIND-205', { replace: true });
        return;
      }

      // Ensure fingerprint hash
      let activeFpHash = fingerprintHash;
      if (!activeFpHash) {
        const fp = await generateDeviceFingerprint();
        if (!fp.success || !fp.hash) {
          clearAttemptState();
          navigate('/block/contact-admin?ref=BIND-200', { replace: true });
          return;
        }
        activeFpHash = fp.hash;
        setFingerprintHash(fp.hash);
        updateAttemptFingerprint(fp.hash, isPrivate);
      }

      const deviceId = getOrCreateDeviceId();

      // Call authoritative backend /api/device-check
      const deviceCheck = await attendanceService.checkDevice({
        attemptToken: currentAttempt.attempt_token,
        studentId: foundStudent.id,
        fingerprint: activeFpHash,
        localDeviceId: deviceId,
        incognitoSignal: isPrivate,
      });

      const ref = deviceCheck.reference_code || 'BIND-204';
      const refEncoded = encodeURIComponent(ref);

      // Handle server device check response
      if (deviceCheck.action === 'OK') {
        // Success: write localStorage binding (post-confirmation only!)
        await bindDeviceToMatric(foundStudent.matric_no);
        updateAttemptStudent(foundStudent);
        updateAttemptFingerprint(activeFpHash, isPrivate);

        // Advance to location check if enabled by lecturer, or straight to selfie if disabled
        if (Boolean(currentAttempt?.session?.location_enabled)) {
          navigate('/attend/location', { replace: false });
        } else {
          navigate('/attend/selfie', { replace: false });
        }
        return;
      }

      // Clear attempt state on terminal security blocks
      clearAttemptState();

      if (ref.startsWith('BIND-205') || deviceCheck.action === 'OPEN_NORMAL_BROWSER') {
        navigate(`/block/incognito?ref=${refEncoded}`, { replace: true });
        return;
      }

      if (ref.startsWith('BIND-201')) {
        navigate(`/block/new-device?ref=${refEncoded}`, { replace: true });
        return;
      }

      if (ref.startsWith('BIND-202')) {
        navigate(`/block/device-in-use?ref=${refEncoded}`, { replace: true });
        return;
      }

      if (ref.startsWith('BIND-203')) {
        navigate(`/block/shared-device?ref=${refEncoded}`, { replace: true });
        return;
      }

      // Default for BIND-204 and other CONTACT_ADMIN codes
      navigate(`/block/contact-admin?ref=${refEncoded}`, { replace: true });
    } catch (err: unknown) {
      console.error('Device check error:', err);
      if (err instanceof ApiError) {
        const ref = err.data?.reference_code || 'BIND-204';
        const refEncoded = encodeURIComponent(ref);

        if (ref.startsWith('BIND-201')) {
          clearAttemptState();
          navigate(`/block/new-device?ref=${refEncoded}`, { replace: true });
          return;
        }
        if (ref.startsWith('BIND-202')) {
          clearAttemptState();
          navigate(`/block/device-in-use?ref=${refEncoded}`, { replace: true });
          return;
        }
        if (ref.startsWith('BIND-205')) {
          clearAttemptState();
          navigate(`/block/incognito?ref=${refEncoded}`, { replace: true });
          return;
        }
        if (err.status === 409 || err.status === 403) {
          clearAttemptState();
          navigate(`/block/contact-admin?ref=${refEncoded}`, { replace: true });
          return;
        }
        setErrorBanner(err.message || 'Device verification could not be completed.');
      } else {
        setErrorBanner('Network error connecting to verification server.');
      }
    } finally {
      setBindingInProgress(false);
    }
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center overflow-x-hidden">
      {/* Header with Step 1 (Details) */}
      <Header
        currentStep="identity"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-3 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col min-w-0">
        {/* Step Guide Card */}
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm border border-slate-200/80 mb-3 sm:mb-4 min-w-0">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-blue-50 border border-blue-100 text-[#1E40AF] flex items-center justify-center mb-3">
            <UserCheck className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>

          <h2 className="text-base font-bold text-slate-900 tracking-tight mb-1">
            Student Identification
          </h2>
          <p className="text-xs text-slate-500 mb-4 sm:mb-5">
            Type your matriculation number to verify enrollment
          </p>

          {/* Error Banner */}
          {errorBanner && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-xs text-red-800">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold break-words">{errorBanner}</p>
                {rateLimitedUntil && (
                  <p className="mt-1 text-slate-600">
                    Retry in <strong>{rateLimitSeconds}s</strong>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Matric Input Form */}
          {!foundStudent && (
            <div className="space-y-3 sm:space-y-4">
              <div>
                <label
                  htmlFor="matricInput"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                >
                  Matriculation Number
                </label>
                <div className="relative">
                  <input
                    id="matricInput"
                    type="text"
                    value={matricInput}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (matricInput.trim().length >= 5) {
                          performLookup(matricInput);
                        }
                      }
                    }}
                    placeholder="e.g. ADUN/FS/COM/25/001"
                    readOnly={loading || Boolean(rateLimitedUntil)}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck="false"
                    className="w-full bg-slate-50 border-2 border-slate-200 focus:border-[#1E40AF] focus:bg-white text-slate-900 font-mono text-base sm:text-sm uppercase rounded-xl sm:rounded-2xl px-3.5 sm:px-4 py-3 sm:py-3.5 outline-none transition-all placeholder:text-slate-400 placeholder:normal-case font-bold placeholder:text-xs min-[360px]:placeholder:text-sm"
                  />
                  {loading && (
                    <div className="absolute right-3.5 top-3.5 text-[#1E40AF]">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Enter your matric number and click Verify (or press Enter)
                </p>
              </div>

              {/* Manual Lookup button fallback */}
              <button
                type="button"
                onClick={() => performLookup(matricInput)}
                disabled={loading || matricInput.length < 5 || Boolean(rateLimitedUntil)}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-all active:scale-[0.99]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Searching university roster...</span>
                  </>
                ) : (
                  <>
                    <span>Verify Matric Number</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {/* Student Confirmation Card (Shown once matric is resolved) */}
          {foundStudent && (
            <div className="space-y-3 sm:space-y-4">
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-3.5 sm:p-4 text-left relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-[#1E40AF] bg-blue-100/80 px-2 py-0.5 rounded-md">
                    Enrolled Student
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                </div>

                <div className="text-sm font-extrabold text-slate-900 leading-tight break-words">
                  {foundStudent.surname}, {foundStudent.first_name}
                </div>
                <div className="text-xs font-mono font-bold text-[#1E40AF] mt-0.5 break-all">
                  {foundStudent.matric_no}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-blue-200/60 text-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                      Program
                    </span>
                    <span className="font-bold text-slate-700 text-[11px] leading-tight block break-words">
                      {foundStudent.program}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                      Level
                    </span>
                    <span className="font-bold text-slate-700 text-[11px] leading-tight block">
                      {foundStudent.level} Level
                    </span>
                  </div>
                </div>

                {/* Subtitle UX hint based on localStorage check */}
                {bindingHint && (
                  <div className="mt-3 pt-2 border-t border-blue-200/60 flex items-center gap-1.5 text-[11px]">
                    {bindingHint.hasBinding && bindingHint.isMatch ? (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <Smartphone className="w-3 h-3 text-emerald-600 shrink-0" /> This device remembers you
                      </span>
                    ) : bindingHint.hasBinding && !bindingHint.isMatch ? (
                      <span className="text-amber-800 font-medium leading-tight">
                        Note: If this device belonged to another student, admin reset will be required.
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Action Buttons: Continue vs Edit */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={bindingInProgress}
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 disabled:bg-slate-300 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-all active:scale-[0.99]"
                >
                  {bindingInProgress ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verifying device binding...</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {Boolean(attempt?.session?.location_enabled)
                          ? 'Continue to Location Check'
                          : 'Continue to Selfie Capture'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={bindingInProgress}
                  className="w-full min-h-[40px] flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 text-slate-600 font-semibold text-xs py-2.5 px-4 rounded-xl border border-slate-200 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Not you? Edit matric number</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security badge footer */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5 mt-auto pb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1E40AF]" />
          <span>ADUN Strict 1-Device Binding Enforced</span>
        </div>
      </div>
    </div>
  );
};
