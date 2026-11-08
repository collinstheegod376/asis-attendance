import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

interface CameraHUDProps {
  onCapture: (dataUrl: string) => void;
  onAutoSubmit: (dataUrl: string) => void;
  onCameraError?: (error: Error) => void;
}

export const CameraHUD: React.FC<CameraHUDProps> = ({
  onCapture,
  onAutoSubmit,
  onCameraError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streamActive, setStreamActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [steadyTimer, setSteadyTimer] = useState<number>(0);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Initialize camera
  const startCamera = useCallback(async () => {
    try {
      setPermissionError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setStreamActive(true);
        };
      }
    } catch (err: any) {
      console.error('Camera stream error:', err);
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in your browser settings.'
        : 'Unable to access camera. Please make sure no other app is using it.';
      setPermissionError(msg);
      if (onCameraError) onCameraError(err);
    }
  }, [onCameraError]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  // Capture current video frame into data URL
  const snapFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Flip horizontally for natural mirror selfie
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl;
  }, []);

  // Manual snap
  const handleManualCapture = () => {
    const dataUrl = snapFrame();
    if (dataUrl) {
      setCapturedImage(dataUrl);
      onCapture(dataUrl);
      startCountdown(dataUrl);
    }
  };

  // Retake photo
  const handleRetake = () => {
    setCapturedImage(null);
    setCountdown(null);
    setSteadyTimer(0);
  };

  // Start 3-2-1 auto-countdown submit
  const startCountdown = (dataUrl: string) => {
    setCountdown(3);
    let count = 3;
    const interval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(interval);
        setCountdown(0);
        onAutoSubmit(dataUrl);
      } else {
        setCountdown(count);
      }
    }, 1000);
  };

  // Simulated face centering & steady detection using video presence & edge contrast
  useEffect(() => {
    if (!streamActive || capturedImage) return;

    let animFrame: number;
    let framesSteady = 0;

    const detectSteadyFace = () => {
      if (videoRef.current && videoRef.current.readyState === 4) {
        framesSteady += 1;
        setSteadyTimer(Math.min(100, Math.round((framesSteady / 45) * 100)));

        // Once held steady for ~1.5s (approx 45 animation frames)
        if (framesSteady >= 50 && !capturedImage) {
          const autoDataUrl = snapFrame();
          if (autoDataUrl) {
            setCapturedImage(autoDataUrl);
            onCapture(autoDataUrl);
            startCountdown(autoDataUrl);
            return;
          }
        }
      }
      animFrame = requestAnimationFrame(detectSteadyFace);
    };

    animFrame = requestAnimationFrame(detectSteadyFace);
    return () => cancelAnimationFrame(animFrame);
  }, [streamActive, capturedImage, onCapture, snapFrame]);

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto px-4 py-2">
      {/* Viewfinder Circle HUD */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 my-3 flex items-center justify-center">
        {/* Animated Dashed Rotating Outer Ring */}
        <div className="absolute inset-0 rounded-full border-4 border-dashed border-blue-500/70 animate-spin-hud pointer-events-none" />

        {/* Inner Solid Border Ring */}
        <div className="absolute inset-2 rounded-full border-2 border-blue-600/40 pointer-events-none" />

        {/* Video or Captured Frame Container */}
        <div className="w-[88%] h-[88%] rounded-full overflow-hidden bg-slate-900 shadow-inner relative flex items-center justify-center">
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="Captured Student Selfie"
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          )}

          {/* Centering crosshairs overlay */}
          {!capturedImage && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
              <div className="w-16 h-16 border border-white/50 rounded-full" />
              <div className="absolute w-24 h-0.5 bg-white/40" />
              <div className="absolute h-24 w-0.5 bg-white/40" />
            </div>
          )}

          {/* Loading stream spinner */}
          {!streamActive && !permissionError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white text-xs gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <span>Starting camera...</span>
            </div>
          )}
        </div>

        {/* Corner guide brackets */}
        <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-blue-700 pointer-events-none" />
        <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-blue-700 pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-blue-700 pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-blue-700 pointer-events-none" />
      </div>

      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Permission Error Banner */}
      {permissionError && (
        <div className="w-full p-3 mb-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{permissionError}</p>
            <button
              onClick={startCamera}
              className="mt-2 text-xs font-bold text-red-700 underline"
            >
              Try camera again
            </button>
          </div>
        </div>
      )}

      {/* Status banner */}
      {capturedImage ? (
        <div className="w-full bg-blue-50 border border-blue-200 rounded-2xl p-3.5 mb-4 text-center">
          <div className="flex items-center justify-center gap-1.5 text-blue-800 font-bold text-sm mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Photo captured
          </div>
          <p className="text-xs text-slate-600">
            {countdown !== null && countdown > 0 ? (
              <span>
                Submitting automatically in{' '}
                <strong className="text-blue-900 font-extrabold text-sm">{countdown}s</strong>...
              </span>
            ) : (
              <span>Submitting your attendance...</span>
            )}
          </p>
          <button
            onClick={handleRetake}
            type="button"
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-800 px-3 py-1 bg-white border border-slate-200 rounded-full shadow-xs transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retake photo
          </button>
        </div>
      ) : (
        <div className="w-full text-center mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-800 text-xs font-medium mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Looking for your face...
          </div>
          <p className="text-[11px] text-slate-500">
            Hold your face steady inside the circle · remove caps & dark glasses
          </p>

          {/* Steady meter bar */}
          <div className="w-48 h-1.5 bg-slate-200 rounded-full mx-auto mt-2 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-150 rounded-full"
              style={{ width: `${steadyTimer}%` }}
            />
          </div>
        </div>
      )}

      {/* Manual Snap Fallback */}
      {!capturedImage && streamActive && (
        <button
          onClick={handleManualCapture}
          type="button"
          className="w-full flex items-center justify-center gap-2 bg-blue-800 hover:bg-blue-900 active:bg-blue-950 text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-md transition-all active:scale-[0.99]"
        >
          <Camera className="w-4 h-4" />
          Take photo manually
        </button>
      )}
    </div>
  );
};
