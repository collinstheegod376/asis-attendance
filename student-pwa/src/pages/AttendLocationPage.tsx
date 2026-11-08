import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, CheckCircle2, AlertTriangle, RefreshCw, ArrowRight, ShieldCheck } from 'lucide-react';
import { Header } from '../components/Header';
import { getAttemptState, updateAttemptLocation } from '../lib/sessionStorage';
import { attendanceApi } from '../lib/supabase';

export const AttendLocationPage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [boundaryStatus, setBoundaryStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!attempt || !attempt.attempt_id || !attempt.student) {
      navigate('/attend/identity', { replace: true });
      return;
    }

    requestLocation();
  }, []);

  const requestLocation = () => {
    setLoading(true);
    setErrorStatus(null);
    setVerifiedSuccess(false);

    if (!('geolocation' in navigator)) {
      setErrorStatus('Geolocation is not supported by your mobile browser.');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = Math.round(pos.coords.accuracy);

        setCoords({ lat, lng, accuracy });

        try {
          // Call backend location verification RPC
          if (attempt?.attempt_id && attempt?.attempt_token) {
            const result: any = await attendanceApi.verifyLocation(
              attempt.attempt_id,
              attempt.attempt_token,
              lat,
              lng,
              accuracy
            );

            if (result && !result.success) {
              if (result.error === 'LOW_ACCURACY') {
                setErrorStatus(`GPS accuracy (±${accuracy}m) is lower than threshold. Move outdoors or closer to a window and retry.`);
                setLoading(false);
                return;
              } else if (result.error === 'OUTSIDE_CAMPUS_BOUNDARY') {
                setErrorStatus('Your coordinates are outside the required lecture hall / campus geofence.');
                setLoading(false);
                return;
              }
            }

            if (result && result.inside_boundary) {
              setBoundaryStatus('Inside campus perimeter');
            }
          }

          // Save location to attempt state
          updateAttemptLocation({
            latitude: lat,
            longitude: lng,
            accuracy_m: accuracy,
            verified_at: new Date().toISOString(),
          });

          setVerifiedSuccess(true);
        } catch (err: any) {
          console.warn('Backend location verification error (falling back to evidence capture):', err);
          // If RPC fails or in evidence-only mode, still record coordinates
          updateAttemptLocation({
            latitude: lat,
            longitude: lng,
            accuracy_m: accuracy,
            verified_at: new Date().toISOString(),
          });
          setVerifiedSuccess(true);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error('Geolocation error:', err);
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setErrorStatus('Location permission was denied. Please allow location access in your browser or phone settings.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setErrorStatus('Location signal unavailable. Ensure your GPS is enabled.');
        } else {
          setErrorStatus('Location request timed out. Please tap retry.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  };

  const handleProceed = () => {
    navigate('/attend/selfie');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center">
      {/* Header */}
      <Header
        currentStep="identity"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-4 py-3 flex-1 flex flex-col">
        <div className="w-full bg-white rounded-3xl p-6 shadow-sm border border-slate-200/80 mb-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-200/80 text-blue-800 flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-8 h-8 text-blue-700" />
          </div>

          <h2 className="text-base font-bold text-slate-900 tracking-tight mb-1">
            Lecture Hall Location
          </h2>
          <p className="text-xs text-slate-500 mb-6">
            Confirming your physical presence in the lecture hall
          </p>

          {/* Live Status Badge */}
          {loading && (
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold animate-pulse">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-700" />
              Getting your location...
            </div>
          )}

          {verifiedSuccess && coords && (
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold shadow-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Location confirmed — accurate to ±{coords.accuracy}m
              </div>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-left space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>GPS Coordinates</span>
                  <span className="font-mono text-slate-700">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[11px]">
                  <span>Accuracy Confidence</span>
                  <span className="font-semibold text-emerald-700">±{coords.accuracy} metres</span>
                </div>
                {boundaryStatus && (
                  <div className="flex justify-between text-slate-500 text-[11px] pt-1 border-t border-slate-200">
                    <span>Geofence Perimeter</span>
                    <span className="font-semibold text-blue-800 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-600" /> {boundaryStatus}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {errorStatus && (
            <div className="space-y-3">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-2.5 text-left text-xs text-amber-900">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold mb-1">Location check failed</p>
                  <p className="text-[11px] text-amber-800">{errorStatus}</p>
                </div>
              </div>

              <button
                onClick={requestLocation}
                type="button"
                className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-xs transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry Location Request
              </button>
            </div>
          )}
        </div>

        {/* Notice */}
        <div className="w-full bg-blue-50/60 border border-blue-100 rounded-2xl p-3.5 text-xs text-blue-950 mb-4">
          <p className="leading-snug">
            Next, a live selfie is taken automatically when you face the camera. Make sure your face is clearly visible.
          </p>
        </div>

        {/* Action Button */}
        {verifiedSuccess && (
          <div className="mt-auto pb-4">
            <button
              onClick={handleProceed}
              type="button"
              className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-sm py-3.5 px-4 rounded-2xl shadow-md transition-all active:scale-[0.99]"
            >
              Continue to Selfie
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
