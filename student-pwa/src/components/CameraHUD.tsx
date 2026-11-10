import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, CheckCircle2, AlertCircle, Smile, Eye, ArrowLeftCircle } from 'lucide-react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

interface CameraHUDProps {
  onCapture: (dataUrl: string) => void;
  onAutoSubmit: (dataUrl: string) => void;
  onCameraError?: (error: Error) => void;
}

type ChallengeType = 'blink' | 'turn_left' | 'smile';

interface ChallengeState {
  type: ChallengeType;
  prompt: string;
  completed: boolean;
  progressText: string;
}

// Distance helper
function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Calculates Eye Aspect Ratio (EAR) from landmarks
function calculateEAR(
  landmarks: { x: number; y: number; z: number }[],
  top1: number,
  bot1: number,
  top2: number,
  bot2: number,
  left: number,
  right: number
): number {
  const v1 = dist(landmarks[top1], landmarks[bot1]);
  const v2 = dist(landmarks[top2], landmarks[bot2]);
  const h = dist(landmarks[left], landmarks[right]);
  return h === 0 ? 0 : (v1 + v2) / (2 * h);
}

export const CameraHUD: React.FC<CameraHUDProps> = ({
  onCapture,
  onAutoSubmit,
  onCameraError,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const [cameraStarted, setCameraStarted] = useState(!isIOS);
  const [streamActive, setStreamActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);

  // Liveness challenge state
  const [challenge, setChallenge] = useState<ChallengeState>(() => {
    const list: { type: ChallengeType; prompt: string }[] = [
      { type: 'blink', prompt: 'Please blink twice' },
      { type: 'turn_left', prompt: 'Please turn head slightly left' },
      { type: 'smile', prompt: 'Please smile' },
    ];
    const picked = list[Math.floor(Math.random() * list.length)];
    return {
      type: picked.type,
      prompt: picked.prompt,
      completed: false,
      progressText: 'Looking for your face...',
    };
  });

  // Tracking refs for multi-frame detection
  const challengeStateRef = useRef({
    blinkCount: 0,
    eyesClosed: false,
    firstBlinkTime: 0,
    headTurnFrames: 0,
    smileFrames: 0,
    startTime: Date.now(),
    completed: false,
  });

  // Stop all media stream tracks defensively
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    setStreamActive(false);
  }, []);

  // Handle visibility change: stop tracks if tab becomes hidden
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopStream();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopStream]);

  // Clean unmount defensive stop
  useEffect(() => {
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      stopStream();
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {}
        landmarkerRef.current = null;
      }
    };
  }, [stopStream]);

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    let active = true;

    async function initModel() {
      try {
        setModelLoading(true);
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        if (!active) return;

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
        });

        if (!active) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setModelLoading(false);
      } catch (err) {
        console.warn('GPU landmarker init failed, retrying with CPU:', err);
        try {
          const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
          if (!active) return;
          const cpuLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/face_landmarker.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numFaces: 2,
            outputFaceBlendshapes: true,
          });
          if (!active) {
            cpuLandmarker.close();
            return;
          }
          landmarkerRef.current = cpuLandmarker;
          setModelLoading(false);
        } catch (cpuErr) {
          console.error('Face landmarker could not be initialized:', cpuErr);
          if (active) {
            setModelLoading(false);
            setPermissionError('Face detection module failed to load. Please refresh.');
          }
        }
      }
    }

    initModel();

    return () => {
      active = false;
    };
  }, []);

  // Initialize Camera
  const startCamera = useCallback(async () => {
    try {
      setPermissionError(null);
      setTimedOut(false);
      stopStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraStarted(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current
            ?.play()
            .then(() => setStreamActive(true))
            .catch(() => setStreamActive(true));
        };
      }

      // Reset challenge timer & states
      challengeStateRef.current = {
        blinkCount: 0,
        eyesClosed: false,
        firstBlinkTime: 0,
        headTurnFrames: 0,
        smileFrames: 0,
        startTime: Date.now(),
        completed: false,
      };
    } catch (err: any) {
      console.error('Camera stream error:', err);
      const msg =
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser settings.'
          : 'Unable to access camera. Please make sure no other application is using it.';
      setPermissionError(msg);
      if (onCameraError) onCameraError(err);
    }
  }, [stopStream, onCameraError]);

  useEffect(() => {
    if (!isIOS) {
      startCamera();
    }
  }, [isIOS, startCamera]);

  // Capture current video frame into 480x480 center-cropped data URL
  const snapFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Center crop square
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropSize = Math.min(vw, vh);
    const sx = (vw - cropSize) / 2;
    const sy = (vh - cropSize) / 2;

    // Mirror image for natural selfie view
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, 480, 480);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    // STOP all tracks immediately after capture
    stopStream();

    return dataUrl;
  }, [stopStream]);

  // Complete challenge and trigger photo submission
  const triggerCompletion = useCallback(() => {
    if (challengeStateRef.current.completed) return;
    challengeStateRef.current.completed = true;

    setChallenge((prev) => ({
      ...prev,
      completed: true,
      progressText: 'Challenge completed! Capturing photo...',
    }));

    const captured = snapFrame();
    if (captured) {
      setCapturedImage(captured);
      onCapture(captured);
      onAutoSubmit(captured);
    }
  }, [snapFrame, onCapture, onAutoSubmit]);

  // Main Face Landmarker and Liveness Loop
  useEffect(() => {
    if (!streamActive || capturedImage || timedOut) return;

    let animId: number;

    const processFrame = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;

      if (!video || video.readyState < 2 || !landmarker) {
        animId = requestAnimationFrame(processFrame);
        return;
      }

      // 15-second timeout check
      const elapsed = (Date.now() - challengeStateRef.current.startTime) / 1000;
      if (elapsed > 15 && !challengeStateRef.current.completed) {
        setTimedOut(true);
        stopStream();
        return;
      }

      try {
        const results = landmarker.detectForVideo(video, performance.now());
        const numFaces = results?.faceLandmarks?.length || 0;

        if (numFaces === 0) {
          setChallenge((prev) => ({
            ...prev,
            progressText: 'Center your face in circle',
          }));
        } else if (numFaces > 1) {
          setChallenge((prev) => ({
            ...prev,
            progressText: 'Multiple faces detected — 1 person only',
          }));
        } else {
          // Exactly ONE face detected!
          const landmarks = results.faceLandmarks[0];
          const blendshapes = results.faceBlendshapes?.[0]?.categories || [];

          const currentType = challenge.type;

          if (currentType === 'blink') {
            // Blink detection: EAR or blendshapes
            const leftEAR = calculateEAR(landmarks, 159, 145, 158, 153, 33, 133);
            const rightEAR = calculateEAR(landmarks, 386, 374, 387, 373, 362, 263);
            const avgEAR = (leftEAR + rightEAR) / 2;

            const blinkLeft = blendshapes.find((b) => b.categoryName === 'eyeBlinkLeft')?.score ?? 0;
            const blinkRight = blendshapes.find((b) => b.categoryName === 'eyeBlinkRight')?.score ?? 0;
            const avgBlinkScore = (blinkLeft + blinkRight) / 2;

            const isEyesClosed = avgEAR < 0.2 || avgBlinkScore > 0.55;
            const isEyesOpen = avgEAR > 0.28 || avgBlinkScore < 0.3;

            if (isEyesClosed && !challengeStateRef.current.eyesClosed) {
              challengeStateRef.current.eyesClosed = true;
            } else if (isEyesOpen && challengeStateRef.current.eyesClosed) {
              challengeStateRef.current.eyesClosed = false;
              challengeStateRef.current.blinkCount += 1;

              if (challengeStateRef.current.blinkCount === 1) {
                challengeStateRef.current.firstBlinkTime = Date.now();
                setChallenge((prev) => ({
                  ...prev,
                  progressText: 'Blink 1 detected! Blink once more...',
                }));
              } else if (challengeStateRef.current.blinkCount >= 2) {
                const interval = (Date.now() - challengeStateRef.current.firstBlinkTime) / 1000;
                if (interval <= 3.5) {
                  triggerCompletion();
                  return;
                } else {
                  // Reset if took too long
                  challengeStateRef.current.blinkCount = 1;
                  challengeStateRef.current.firstBlinkTime = Date.now();
                }
              }
            } else {
              setChallenge((prev) => ({
                ...prev,
                progressText:
                  challengeStateRef.current.blinkCount === 1
                    ? 'Blink once more...'
                    : 'Blink twice naturally',
              }));
            }
          } else if (currentType === 'turn_left') {
            // Head turn detection
            // Note: Since video is mirrored for display, turning head left moves nose towards user's left
            const noseTip = landmarks[1];
            let minX = 1;
            let maxX = 0;
            for (let i = 0; i < landmarks.length; i++) {
              if (landmarks[i].x < minX) minX = landmarks[i].x;
              if (landmarks[i].x > maxX) maxX = landmarks[i].x;
            }
            const faceWidth = Math.max(0.01, maxX - minX);
            const faceCenter = (minX + maxX) / 2;
            const relNoseOffset = (noseTip.x - faceCenter) / faceWidth;

            // Turn left check: nose shifts relative to face bounding center
            if (relNoseOffset > 0.12 || relNoseOffset < -0.12) {
              challengeStateRef.current.headTurnFrames += 1;
              if (challengeStateRef.current.headTurnFrames >= 2) {
                triggerCompletion();
                return;
              }
            } else {
              challengeStateRef.current.headTurnFrames = 0;
              setChallenge((prev) => ({
                ...prev,
                progressText: 'Turn your head slightly to the left',
              }));
            }
          } else if (currentType === 'smile') {
            // Smile detection
            const smileLeft = blendshapes.find((b) => b.categoryName === 'mouthSmileLeft')?.score ?? 0;
            const smileRight = blendshapes.find((b) => b.categoryName === 'mouthSmileRight')?.score ?? 0;
            const avgSmile = (smileLeft + smileRight) / 2;

            // Geometry check fallback: mouth width relative to eye distance
            const mouthWidth = dist(landmarks[61], landmarks[291]);
            const eyeDistance = dist(landmarks[33], landmarks[263]);
            const mouthRatio = eyeDistance === 0 ? 0 : mouthWidth / eyeDistance;

            if (avgSmile > 0.4 || mouthRatio > 0.85) {
              challengeStateRef.current.smileFrames += 1;
              if (challengeStateRef.current.smileFrames >= 3) {
                triggerCompletion();
                return;
              }
            } else {
              challengeStateRef.current.smileFrames = 0;
              setChallenge((prev) => ({
                ...prev,
                progressText: 'Give a gentle smile',
              }));
            }
          }
        }
      } catch (err) {
        console.warn('Frame detection error:', err);
      }

      animId = requestAnimationFrame(processFrame);
    };

    animId = requestAnimationFrame(processFrame);
    animFrameRef.current = animId;

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [streamActive, capturedImage, timedOut, challenge.type, triggerCompletion, stopStream]);

  // Retake photo / Retry after timeout
  const handleRetry = () => {
    setCapturedImage(null);
    setTimedOut(false);
    challengeStateRef.current = {
      blinkCount: 0,
      eyesClosed: false,
      firstBlinkTime: 0,
      headTurnFrames: 0,
      smileFrames: 0,
      startTime: Date.now(),
      completed: false,
    };

    const list: { type: ChallengeType; prompt: string }[] = [
      { type: 'blink', prompt: 'Please blink twice' },
      { type: 'turn_left', prompt: 'Please turn head slightly left' },
      { type: 'smile', prompt: 'Please smile' },
    ];
    const picked = list[Math.floor(Math.random() * list.length)];
    setChallenge({
      type: picked.type,
      prompt: picked.prompt,
      completed: false,
      progressText: 'Looking for your face...',
    });

    startCamera();
  };

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto px-2 sm:px-4 py-1 sm:py-2 min-w-0">
      {/* Viewfinder Circle HUD */}
      <div className="relative w-52 h-52 min-[360px]:w-60 min-[360px]:h-60 sm:w-68 sm:h-68 my-2 sm:my-3 flex items-center justify-center shrink-0">
        {/* Animated Dashed Rotating Outer Ring */}
        <div
          className={`absolute inset-0 rounded-full border-4 border-dashed transition-colors duration-300 pointer-events-none ${
            challenge.completed
              ? 'border-emerald-500'
              : timedOut
              ? 'border-amber-500'
              : 'border-blue-500/70 animate-spin-hud'
          }`}
        />

        {/* Inner Solid Border Ring */}
        <div
          className={`absolute inset-2 rounded-full border-2 transition-colors duration-300 pointer-events-none ${
            challenge.completed
              ? 'border-emerald-500/80'
              : timedOut
              ? 'border-amber-500/80'
              : 'border-blue-600/40'
          }`}
        />

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
          {!capturedImage && !timedOut && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-30">
              <div className="w-14 h-14 sm:w-16 sm:h-16 border border-white/50 rounded-full" />
              <div className="absolute w-20 sm:w-24 h-0.5 bg-white/40" />
              <div className="absolute h-20 sm:h-24 w-0.5 bg-white/40" />
            </div>
          )}

          {/* Loading stream spinner */}
          {!streamActive && !permissionError && cameraStarted && !timedOut && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white text-xs gap-2 p-2 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <span className="text-[11px]">{modelLoading ? 'Initializing face mesh...' : 'Starting camera...'}</span>
            </div>
          )}

          {/* iOS User Gesture Initial Tap */}
          {!cameraStarted && !capturedImage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white text-xs p-3 sm:p-4 text-center gap-2 sm:gap-3">
              <Camera className="w-7 h-7 sm:w-8 sm:h-8 text-blue-400" />
              <p className="font-semibold text-slate-200 text-xs">Camera access required</p>
              <button
                type="button"
                onClick={startCamera}
                className="px-4 py-2 min-h-[38px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full font-bold shadow-md text-xs"
              >
                Enable Camera
              </button>
            </div>
          )}

          {/* 15s Timeout state */}
          {timedOut && !capturedImage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 text-white text-xs p-3 sm:p-4 text-center gap-2 sm:gap-3">
              <AlertCircle className="w-7 h-7 sm:w-8 sm:h-8 text-amber-400" />
              <p className="font-semibold text-slate-200 text-xs">Liveness timeout (15s)</p>
              <p className="text-[10px] text-slate-400">
                Liveness check could not be completed.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="px-4 py-2 min-h-[38px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full font-bold shadow-md flex items-center gap-1.5 text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry verification
              </button>
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
          <div className="flex-1 min-w-0">
            <p className="font-semibold break-words">{permissionError}</p>
            <button
              onClick={startCamera}
              className="mt-2 text-xs font-bold text-red-700 underline"
            >
              Try camera again
            </button>
          </div>
        </div>
      )}

      {/* Status & Live Challenge Box */}
      {capturedImage ? (
        <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl p-3 sm:p-3.5 mb-3 text-center">
          <div className="flex items-center justify-center gap-1.5 text-emerald-800 font-bold text-xs sm:text-sm mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Liveness verified · Photo captured</span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-600">
            Submitting verified selfie to university storage...
          </p>
          <button
            onClick={handleRetry}
            type="button"
            className="mt-2.5 min-h-[36px] inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-800 px-3 py-1 bg-white border border-slate-200 rounded-full shadow-xs transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retake photo
          </button>
        </div>
      ) : (
        <div className="w-full text-center mb-3">
          {/* Liveness Challenge Card */}
          <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-2.5 sm:p-3 shadow-xs">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              {challenge.type === 'blink' && <Eye className="w-4 h-4 text-blue-700 shrink-0" />}
              {challenge.type === 'turn_left' && <ArrowLeftCircle className="w-4 h-4 text-blue-700 shrink-0" />}
              {challenge.type === 'smile' && <Smile className="w-4 h-4 text-blue-700 shrink-0" />}
              <span className="text-[11px] sm:text-xs font-extrabold text-blue-950 uppercase tracking-wider">
                Liveness Challenge
              </span>
            </div>

            <p className="text-xs sm:text-sm font-bold text-blue-900 mb-1.5 break-words">
              {challenge.prompt}
            </p>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800 text-[10px] min-[360px]:text-[11px] font-medium shadow-xs max-w-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="truncate">{challenge.progressText}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
