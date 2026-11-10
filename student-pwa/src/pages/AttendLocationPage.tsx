import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, AlertTriangle, RefreshCw, ArrowRight, ShieldCheck } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptLocation, clearAttemptState } from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';

export const AttendLocationPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);

  // Step Guard: Identity must be completed
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

    requestLocation();
  }, []);

  const requestLocation = () => {
    setLoading(true);
    setErrorStatus(null);
    setVerifiedSuccess(false);
    setBoundaryStatus(null);

    if (!('geolocation' in navigator)) {
      setErrorStatus('Geolocation is not supported by your mobile browser.');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Pass raw floating-point accuracy, never Math.round (Fixes SEC-07, PERF-12)
        const accuracy = pos.coords.accuracy;

        setCoords({ lat, lng, accuracy });

        try {
          if (!attempt?.attempt_token) {
            clearAttemptState();
            navigate('/expired', { replace: true });
            return;
          }

          // Call backend location verification Edge Function
          const result = await attendanceService.verifyLocation({
            attemptToken: attempt.attempt_token,
            latitude: lat,
            longitude: lng,
            accuracyM: accuracy,
          });

          if (!result.success) {
            setVerifiedSuccess(false);
            if (result.error === 'ATTEMPT_EXPIRED' || result.error === 'SESSION_EXPIRED') {
              clearAttemptState();
              navigate('/expired', { replace: true });
              return;
            }
            if (result.error === 'SESSION_CLOSED') {
              clearAttemptState();
              navigate('/closed', { replace: true });
              return;
            }
            if (result.error === 'LOW_ACCURACY') {
              setErrorStatus(`GPS accuracy (±${accuracy.toFixed(1)}m) is too low. Move outdoors or closer to open sky and retry.`);
              setLoading(false);
              return;
            }
            if (result.error === 'OUTSIDE_CLASSROOM_BOUNDARY') {
              const distText = (result as any).distance_m !== undefined ? ` Detected distance: ${(result as any).distance_m}m.` : '';
              setErrorStatus(`You are outside the classroom boundary. You must be within 50m of the lecturer to sign attendance.${distText}`);
              setLoading(false);
              return;
            }
            if (result.error === 'OUTSIDE_CAMPUS_BOUNDARY') {
              setErrorStatus('You are outside the permitted lecture hall / campus area.');
              setLoading(false);
              return;
            }
            if (result.error === 'GEOFENCE_NOT_CONFIGURED') {
              setErrorStatus('Campus boundary is not configured. Contact your lecturer.');
              setLoading(false);
              return;
            }

            setErrorStatus(result.message || 'Location could not be verified.');
            setLoading(false);
            return;
          }

          // Verified success!
          setBoundaryStatus('Inside verified lecture perimeter');
          updateAttemptLocation({
            latitude: lat,
            longitude: lng,
            accuracy_m: accuracy,
            verified_at: new Date().toISOString(),
            inside_boundary: result.inside_boundary,
          });

          setVerifiedSuccess(true);
        } catch (err: unknown) {
          // FAIL CLOSED — NEVER setVerifiedSuccess(true) on error (Fixes SEC-07, QA-08, PERF-12)
          console.error('Location verification exception:', err);
          setVerifiedSuccess(false);

          if (err instanceof ApiError) {
            if (err.code === 'ATTEMPT_EXPIRED' || err.status === 410) {
              clearAttemptState();
              navigate('/expired', { replace: true });
              return;
            }
            if (err.code === 'LOW_ACCURACY') {
              setErrorStatus(`GPS accuracy (±${accuracy.toFixed(1)}m) is too low. Move to open sky and retry.`);
              setLoading(false);
              return;
            }
            if (err.code === 'OUTSIDE_CLASSROOM_BOUNDARY') {
              const distText = err.data?.distance_m !== undefined ? ` Detected distance: ${err.data.distance_m}m.` : '';
              setErrorStatus(`You are outside the classroom boundary. You must be within 50m of the lecturer to sign attendance.${distText}`);
              setLoading(false);
              return;
            }
            if (err.code === 'OUTSIDE_CAMPUS_BOUNDARY') {
              setErrorStatus('You are outside the permitted lecture hall / campus boundary.');
              setLoading(false);
              return;
            }
            if (err.code === 'GEOFENCE_NOT_CONFIGURED') {
              setErrorStatus('Campus boundary is not configured. Contact your lecturer.');
              setLoading(false);
              return;
            }
            if (err.code === 'SESSION_CLOSED' || err.status === 403) {
              clearAttemptState();
              navigate('/closed', { replace: true });
              return;
            }
            setErrorStatus(err.message || 'Location verification failed.');
          } else {
            setErrorStatus('Could not reach the university server. Check your connection and retry.');
          }
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error('Geolocation error:', err);
        setLoading(false);
        setVerifiedSuccess(false);
        if (err.code === err.PERMISSION_DENIED) {
          setErrorStatus('Location permission was denied. Please allow location access in your browser or phone settings.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setErrorStatus('GPS position unavailable. Ensure your device location / GPS is turned on.');
        } else {
          setErrorStatus('Location request timed out. Please tap retry.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const handleProceed = () => {
    if (!verifiedSuccess) return;
    navigate('/attend/selfie');
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center overflow-x-hidden">
      {/* Header with Step 2 (Location) — Fixes QA-15 */}
      <Header
        currentStep="location"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-3 sm:px-4 py-2 sm:py-3 flex-1 flex flex-col min-w-0">
        <div className="w-full bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm border border-slate-200/80 mb-3 sm:mb-4 text-center min-w-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-blue-50 border border-blue-200/80 text-[#1E40AF] flex items-center justify-center mx-auto mb-3 sm:mb-4">
            <MapPin className="w-7 h-7 sm:w-8 sm:h-8 text-[#1E40AF]" />
          </div>

          <h2 className="text-base font-bold text-slate-900 tracking-tight mb-1">
            Lecture Hall Location
          </h2>
          <p className="text-xs text-slate-500 mb-4 sm:mb-6">
            Confirming your physical presence in the lecture hall
          </p>

          {/* Loading status */}
          {loading && (
            <div className="py-5 sm:py-6 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-[#1E40AF] animate-spin" />
              <p className="text-xs font-semibold text-slate-700">
                Acquiring high-accuracy satellite GPS...
              </p>
              <p className="text-[11px] text-slate-400">
                Hold phone steady near open view
              </p>
            </div>
          )}

          {/* Error Banner */}
          {!loading && errorStatus && (
            <div className="mb-4 sm:mb-5 p-3.5 sm:p-4 bg-red-50 border border-red-200 rounded-xl sm:rounded-2xl text-left flex items-start gap-2.5 sm:gap-3 text-xs text-red-800">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold break-words">{errorStatus}</p>
                <button
                  type="button"
                  onClick={requestLocation}
                  className="mt-2.5 min-h-[36px] inline-flex items-center gap-1.5 text-xs font-bold text-[#1E40AF] underline active:opacity-75"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry location check
                </button>
              </div>
            </div>
          )}

          {/* Success card */}
          {!loading && verifiedSuccess && coords && (
            <div className="space-y-3 sm:space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
                </div>
                <div className="text-sm font-extrabold text-emerald-950">
                  Location Verified!
                </div>
                <div className="text-xs text-emerald-800 mt-0.5 break-words">
                  {boundaryStatus || 'Campus Geofence Confirmed'}
                </div>
                <div className="mt-3 pt-2 border-t border-emerald-200/60 text-[11px] text-emerald-800/80 font-mono">
                  GPS Accuracy: ±{coords.accuracy.toFixed(1)}m
                </div>
              </div>

              <button
                type="button"
                onClick={handleProceed}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 bg-[#1E40AF] hover:bg-blue-800 active:bg-blue-900 text-white font-semibold text-xs py-3.5 px-4 rounded-xl shadow-xs transition-all active:scale-[0.99]"
              >
                <span>Continue to Selfie Verification</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Security footer */}
        <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5 mt-auto pb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1E40AF]" />
          <span>ADUN Anti-Spoof Location Verification</span>
        </div>
      </div>
    </div>
  );
};
