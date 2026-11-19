import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Header } from '../components/Header';
import { CameraHUD } from '../components/CameraHUD';
import {
  getAttemptState,
  updateAttemptSelfie,
  clearAttemptLocation,
  clearAttemptState,
  isLocationRequirementSatisfied,
} from '../lib/attemptState';
import { attendanceService, ApiError } from '../lib/attendanceService';
import type { LivenessProof } from '../types';

export const AttendSelfiePage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedProof, setCapturedProof] = useState<LivenessProof | undefined>(undefined);

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
  }, [navigate]);

  const handleCapture = (dataUrl: string, proof?: LivenessProof) => {
    setCapturedDataUrl(dataUrl);
    setCapturedProof(proof);
    setUploadError(null);
  };

  const uploadCapturedSelfie = async (dataUrl: string, proof?: LivenessProof) => {
    const currentAttempt = getAttemptState();
    if (!currentAttempt?.attempt_token) {
      clearAttemptState();
      navigate('/expired', { replace: true });
      return;
    }

    if (!isLocationRequirementSatisfied(currentAttempt)) {
      navigate('/attend/location', { replace: true });
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // POST image as base64 to server Edge Function /api/upload-selfie
      const res = await attendanceService.uploadSelfie(currentAttempt.attempt_token, dataUrl, proof);

      if (!res.selfie_path) {
        throw new Error('Server did not return a valid storage path.');
      }

      // Store canonical selfie_path, dataUrl, and liveness_proof in attempt state
      updateAttemptSelfie(dataUrl, res.selfie_path, proof);

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
        if (
          err.code === 'LOCATION_REQUIRED' ||
          err.code === 'OUTSIDE_CLASSROOM_BOUNDARY' ||
          err.code === 'OUTSIDE_CAMPUS_BOUNDARY' ||
          err.code === 'LOW_ACCURACY'
        ) {
          clearAttemptLocation();
          navigate('/attend/location', { replace: true });
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

  const handleAutoSubmit = (dataUrl: string, proof?: LivenessProof) => {
    uploadCapturedSelfie(dataUrl, proof);
  };

  const handleRetryUpload = () => {
    if (capturedDataUrl) {
      uploadCapturedSelfie(capturedDataUrl, capturedProof);
    }
  };

  const handleRetake = () => {
    setCapturedDataUrl(null);
    setCapturedProof(undefined);
    setUploadError(null);
  };

  const handleCameraError = () => {
    // Only redirect if camera hardware or API is completely unsupported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) {
      navigate('/unsupported', { replace: true });
    }
  };

  if (
    !attempt ||
    !attempt.attempt_id ||
    !attempt.attempt_token ||
    !attempt.student ||
    !isLocationRequirementSatisfied(attempt)
  ) {
    return null;
  }

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
          onRetake={handleRetake}
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
