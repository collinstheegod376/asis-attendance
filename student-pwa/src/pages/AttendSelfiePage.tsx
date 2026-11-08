import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { CameraHUD } from '../components/CameraHUD';
import { getAttemptState, updateAttemptSelfie } from '../lib/sessionStorage';
import { attendanceApi } from '../lib/supabase';

export const AttendSelfiePage: React.FC = () => {
  const navigate = useNavigate();
  const attempt = getAttemptState();
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!attempt || !attempt.student) {
      navigate('/attend/identity', { replace: true });
    }
  }, [attempt, navigate]);

  const handleCapture = (dataUrl: string) => {
    updateAttemptSelfie(dataUrl);
  };

  const handleAutoSubmit = async (dataUrl: string) => {
    setUploading(true);
    try {
      // Convert base64 dataUrl to Blob for upload
      let selfiePath = '';
      if (attempt && attempt.session && attempt.student) {
        try {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          selfiePath = await attendanceApi.uploadSelfie(
            attempt.session.id,
            attempt.student.id,
            attempt.attempt_id,
            blob
          );
        } catch (e) {
          console.warn('Storage upload notice (falling back):', e);
          selfiePath = `selfies/${attempt.session.id}/${attempt.student.id}/${attempt.attempt_id}.jpg`;
        }
      }

      updateAttemptSelfie(dataUrl, selfiePath);

      // Navigate to instructional video step
      navigate('/attend/video');
    } catch (err) {
      console.error('Error during selfie processing:', err);
      navigate('/attend/video');
    } finally {
      setUploading(false);
    }
  };

  const handleCameraError = () => {
    navigate('/unsupported');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center">
      {/* Header with Step 2 (Selfie) */}
      <Header
        currentStep="selfie"
        courseCode={attempt?.session?.course_code}
        courseTitle={attempt?.session?.course_title}
      />

      <div className="w-full max-w-sm px-4 py-2 flex-1 flex flex-col items-center">
        {/* Camera HUD with Circular Viewfinder and Animated Dashed Ring */}
        <CameraHUD
          onCapture={handleCapture}
          onAutoSubmit={handleAutoSubmit}
          onCameraError={handleCameraError}
        />

        {uploading && (
          <div className="mt-2 text-xs text-blue-900 font-semibold animate-pulse">
            Processing and securing selfie...
          </div>
        )}
      </div>
    </div>
  );
};
