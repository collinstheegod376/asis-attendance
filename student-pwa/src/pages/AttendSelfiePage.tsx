import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '../components/Header';
import { CameraHUD } from '../components/CameraHUD';
import { getAttemptState, updateAttemptSelfie, clearAttemptState } from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';

export const AttendSelfiePage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);

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

    if (!attempt.location) {
      navigate('/attend/location', { replace: true });
      return;
    }
  }, [attempt, navigate]);

  const handleCapture = (dataUrl: string) => {
    setCapturedDataUrl(dataUrl);
    setUploadError(null);
  };

  const uploadCapturedSelfie = async (dataUrl: string) => {
    if (!attempt?.attempt_token) {
      clearAttemptState();
      navigate('/expired', { replace: true });
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // POST image as base64 to server Edge Function /api/upload-selfie
      const res = await attendanceService.uploadSelfie(attempt.attempt_token, dataUrl);

      if (!res.selfie_path) {
        throw new Error('Server did not return a valid storage path.');
      }

      // Store canonical selfie_path and dataUrl in attempt state
      updateAttemptSelfie(dataUrl, res.selfie_path);

      // Navigate to instructional video step
      navigate('/attend/video', { replace: false });
    } catch (err: unknown) {
      // Fail closed: do NOT navigate to /attend/video, do NOT fabricate path (Fixes QA-09, SEC-14)
      console.error('Selfie upload failed:', err);

      if (err instanceof ApiError) {
        if (err.code === 'ATTEMPT_EXPIRED' || err.status === 410) {
          clearAttemptState();
          navigate('/expired', { replace: true });
          return;
        }
        setUploadError(err.message || 'Failed to upload selfie proof to university storage.');
      } else {
        setUploadError('Network error uploading selfie. Check your internet connection.');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleAutoSubmit = (dataUrl: string) => {
    uploadCapturedSelfie(dataUrl);
  };

  const handleRetryUpload = () => {
    if (capturedDataUrl) {
      uploadCapturedSelfie(capturedDataUrl);
    }
  };

  const handleCameraError = () => {
    navigate('/unsupported');
  };

  return (
    <div className="min-h-dvh min-h-[100dvh] bg-slate-50 flex flex-col items-center overflow-x-hidden">
      {/* Header with Step 3 (Selfie) */}
      <Header
        currentStep="selfie"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-3 sm:px-4 py-1.5 sm:py-2 flex-1 flex flex-col items-center min-w-0">
        {/* Camera HUD with Circular Viewfinder and Liveness Challenge */}
        <CameraHUD
          onCapture={handleCapture}
          onAutoSubmit={handleAutoSubmit}
          onCameraError={handleCameraError}
        />

        {uploading && (
          <div className="mt-2.5 p-3 bg-blue-50 border border-blue-200 rounded-2xl w-full text-center flex items-center justify-center gap-2 text-xs text-[#1E40AF] font-bold">
            <Loader2 className="w-4 h-4 animate-spin text-[#1E40AF]" />
            <span>Encrypting and uploading selfie proof...</span>
          </div>
        )}

        {uploadError && (
          <div className="mt-2.5 p-3 bg-red-50 border border-red-200 rounded-2xl w-full text-xs text-red-800 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold break-words">{uploadError}</p>
              <button
                type="button"
                onClick={handleRetryUpload}
                disabled={uploading}
                className="mt-2 min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E40AF] text-white rounded-lg font-bold text-xs shadow-xs hover:bg-blue-800 active:bg-blue-900"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry upload
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
