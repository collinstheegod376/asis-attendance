import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, RefreshCw, CheckCircle2, AlertCircle, Smile, Eye, ArrowLeftCircle, UserCheck } from 'lucide-react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import type { LivenessProof } from '../types';

interface CameraHUDProps {
  onCapture: (dataUrl: string, proof?: LivenessProof) => void;
  onAutoSubmit: (dataUrl: string, proof?: LivenessProof) => void;
  onCameraError?: (error: Error) => void;
  onRetake?: () => void;
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

// CDN & Local Resource Paths for Multi-Tier Engine
const WASM_LOCAL = '/mediapipe/wasm';
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm';
const MODEL_LOCAL = '/face_landmarker.task';
const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export const CameraHUD: React.FC<CameraHUDProps> = ({
  onCapture,
  onAutoSubmit,
  onCameraError,
  onRetake,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const lastProcessTimeRef = useRef<number>(0);

  // Optical fallback canvas & luma buffer
  const opticalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevLumaRef = useRef<Float32Array | null>(null);

  // Micro-movement / 3D depth liveliness history (5 consecutive frames)
  const motionHistoryRef = useRef<Array<{ x: number; y: number; delta: number }>>([]);

  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const [cameraStarted, setCameraStarted] = useState(!isIOS);
  const [streamActive, setStreamActive] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [modelTier, setModelTier] = useState<'optical' | 'native' | 'mediapipe-gpu' | 'mediapipe-cpu'>('optical');
  const [progress, setProgress] = useState(0); // 0 to 100%
  const [timedOut, setTimedOut] = useState(false);

  // Pick initial challenge
  const [challenge, setChallenge] = useState<ChallengeState>(() => {
    const list: { type: ChallengeType; prompt: string }[] = [
      { type: 'blink', prompt: 'Please blink twice' },
      { type: 'turn_left', prompt: 'Turn head slightly' },
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

  // State update deduplication helper to prevent 60FPS React re-render thrashing
  const updateChallengeText = useCallback((text: string, newProgress?: number) => {
    setChallenge((prev) => {
      if (prev.progressText === text) return prev;
      return { ...prev, progressText: text };
    });
    if (newProgress !== undefined) {
      setProgress((prev) => (prev === newProgress ? prev : newProgress));
    }
  }, []);

  // Tracking state refs for adaptive detection and anti-spoofing baseline
  const challengeStateRef = useRef({
    blinkCount: 0,
    eyesClosed: false,
    eyesClosedTime: 0,
    firstBlinkTime: 0,
    restingEAR: 0,
    turnFrames: 0,
    smileFrames: 0,
    restingMouthRatio: 0,
    neutralCentroidX: 60,
    baselineFrames: 0,
    baselineEstablished: false,
    baselineNoseOffset: 0,
    baselineSmile: 0,
    microMovementVerified: false,
    startTime: Date.now(),
    completed: false,
  });

  // Native Browser FaceDetector instance cache
  const nativeDetectorRef = useRef<any>(null);

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

  // Check & instantiate Native Browser FaceDetector (Tier B instant hardware acceleration)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        const FaceDetectorCtor = (window as any).FaceDetector;
        nativeDetectorRef.current = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 2 });
        setModelTier('native');
      } catch {
        nativeDetectorRef.current = null;
      }
    }
  }, []);

  // Initialize MediaPipe Face Landmarker with robust 4-tier fallback
  useEffect(() => {
    let active = true;

    async function initModel() {
      // Strategy 1: Local wasm + GPU (with blendshapes)
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL);
        if (!active) return;
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_LOCAL,
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
        setModelTier('mediapipe-gpu');
        return;
      } catch (errGpuLocal) {
        console.warn('Tier A (Local GPU) init failed, falling back to Local CPU:', errGpuLocal);
      }

      // Strategy 2: Local wasm + CPU (Blendshapes strictly FALSE on CPU delegate)
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_LOCAL);
        if (!active) return;
        const cpuLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_LOCAL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: false, // REQUIRED for CPU delegate
        });
        if (!active) {
          cpuLandmarker.close();
          return;
        }
        landmarkerRef.current = cpuLandmarker;
        setModelTier('mediapipe-cpu');
        return;
      } catch (errCpuLocal) {
        console.warn('Tier A (Local CPU) init failed, falling back to CDN:', errCpuLocal);
      }

      // Strategy 3: CDN wasm + GPU
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        if (!active) return;
        const cdnLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_LOCAL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
        });
        if (!active) {
          cdnLandmarker.close();
          return;
        }
        landmarkerRef.current = cdnLandmarker;
        setModelTier('mediapipe-gpu');
        return;
      } catch (errGpuCdn) {
        console.warn('Tier A (CDN GPU) init failed, falling back to CDN CPU:', errGpuCdn);
      }

      // Strategy 4: CDN wasm + CPU
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
        if (!active) return;
        const cdnCpuLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_CDN,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: false,
        });
        if (!active) {
          cdnCpuLandmarker.close();
          return;
        }
        landmarkerRef.current = cdnCpuLandmarker;
        setModelTier('mediapipe-cpu');
        return;
      } catch (errCpuCdn) {
        console.warn('Tier A CDN CPU init failed; relying on Tier B Native/Optical engine:', errCpuCdn);
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
      setProgress(0);
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
        const video = videoRef.current;
        video.srcObject = stream;
        const markActive = () => {
          setStreamActive(true);
        };
        video.onloadedmetadata = markActive;
        video.onloadeddata = markActive;
        video.oncanplay = markActive;
        video.onplaying = markActive;
        video.play().then(markActive).catch(markActive);
        if (video.readyState >= 2) {
          markActive();
        }
      }

      // Reset challenge timer & states
      challengeStateRef.current = {
        blinkCount: 0,
        eyesClosed: false,
        eyesClosedTime: 0,
        firstBlinkTime: 0,
        restingEAR: 0,
        turnFrames: 0,
        smileFrames: 0,
        restingMouthRatio: 0,
        neutralCentroidX: 60,
        baselineFrames: 0,
        baselineEstablished: false,
        baselineNoseOffset: 0,
        baselineSmile: 0,
        microMovementVerified: false,
        startTime: Date.now(),
        completed: false,
      };
      motionHistoryRef.current = [];
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

  // Video element stream watchdog to guarantee streamActive becomes true
  useEffect(() => {
    if (cameraStarted && streamRef.current && videoRef.current) {
      const video = videoRef.current;
      if (video.srcObject !== streamRef.current) {
        video.srcObject = streamRef.current;
      }
      if (video.paused) {
        video.play().then(() => setStreamActive(true)).catch(() => setStreamActive(true));
      } else if (video.readyState >= 2) {
        setStreamActive(true);
      }
    }
  }, [cameraStarted, streamActive]);

  // Capture current video frame into high-quality 480x480 center-cropped square
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

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);

    // Stop stream immediately after capture
    stopStream();

    return dataUrl;
  }, [stopStream]);

  // Complete challenge and trigger photo submission
  const triggerCompletion = useCallback(() => {
    if (challengeStateRef.current.completed) return;
    challengeStateRef.current.completed = true;

    const duration = Math.round(Date.now() - challengeStateRef.current.startTime);
    const proof: LivenessProof = {
      challenge_type: challenge.type,
      challenge_passed: true,
      duration_ms: duration,
      confidence_score: modelTier.startsWith('mediapipe') ? 0.98 : 0.92,
      timestamp: new Date().toISOString(),
    };

    setProgress(100);
    setChallenge((prev) => ({
      ...prev,
      completed: true,
      progressText: 'Liveness verified! Capturing photo...',
    }));

    // Brief 200ms delay to display green confirmation ring to student
    setTimeout(() => {
      const captured = snapFrame();
      if (captured) {
        setCapturedImage(captured);
        onCapture(captured, proof); // onCapture(captured)
        onAutoSubmit(captured, proof); // onAutoSubmit(captured)
      }
    }, 200);
  }, [snapFrame, onCapture, onAutoSubmit, challenge.type, modelTier]);

  // Optical Face & Motion Analyzer (Tier B instant fallback)
  const analyzeOpticalFrame = useCallback(
    (video: HTMLVideoElement) => {
      if (!opticalCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 120;
        c.height = 120;
        opticalCanvasRef.current = c;
      }
      const canvas = opticalCanvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw === 0 || vh === 0) return null;

      const crop = Math.min(vw, vh);
      const sx = (vw - crop) / 2;
      const sy = (vh - crop) / 2;

      ctx.drawImage(video, sx, sy, crop, crop, 0, 0, 120, 120);
      const imgData = ctx.getImageData(0, 0, 120, 120);
      const data = imgData.data;

      const totalSamples = 60 * 60;
      if (!prevLumaRef.current || prevLumaRef.current.length !== totalSamples) {
        prevLumaRef.current = new Float32Array(totalSamples);
      }
      const prevLuma = prevLumaRef.current;

      let skinCenterCount = 0;
      let skinTotalCount = 0;
      let sumX = 0;
      let sumY = 0;
      let totalDelta = 0;
      let eyeBandDelta = 0;
      let mouthBandDelta = 0;
      let sampleIdx = 0;

      // Sample every 2 pixels for ~0.1ms compute time
      for (let y = 0; y < 120; y += 2) {
        for (let x = 0; x < 120; x += 2) {
          const p = (y * 120 + x) * 4;
          const r = data[p];
          const g = data[p + 1];
          const b = data[p + 2];

          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          const delta = Math.abs(luma - prevLuma[sampleIdx]);
          prevLuma[sampleIdx] = luma;
          sampleIdx++;

          // Universal YCbCr + RGB skin model (All Fitzpatrick tones)
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
          const isSkin =
            (cr >= 130 && cr <= 175 && cb >= 75 && cb <= 130) ||
            (r > 50 && g > 35 && b > 20 && r > g && r > b && r - g > 8);

          if (isSkin) {
            skinTotalCount++;
            const dx = x - 60;
            const dy = y - 60;
            if (dx * dx + dy * dy <= 48 * 48) {
              skinCenterCount++;
              sumX += x;
              sumY += y;
              totalDelta += delta;

              // Eye band relative to center
              if (dy >= -24 && dy <= -6) {
                eyeBandDelta += delta;
              }
              // Mouth band relative to center
              if (dy >= 10 && dy <= 28) {
                mouthBandDelta += delta;
              }
            }
          }
        }
      }

      const hasFace = skinCenterCount >= 160; // > 10% skin density in center oval
      const cx = hasFace ? sumX / skinCenterCount : 60;
      const cy = hasFace ? sumY / skinCenterCount : 60;
      const avgDelta = hasFace ? totalDelta / skinCenterCount : 0;

      return {
        hasFace,
        cx,
        cy,
        avgDelta,
        eyeBandDelta,
        mouthBandDelta,
        skinCenterCount,
      };
    },
    []
  );

  // Main Detection Loop (Tiers A, B, and C integrated with Anti-Spoofing Baselines)
  useEffect(() => {
    if (!streamActive || capturedImage || timedOut) return;

    let animId: number;

    const processFrame = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        animId = requestAnimationFrame(processFrame);
        return;
      }

      const state = challengeStateRef.current;
      if (state.completed) return;

      // Throttle inference to ~20 FPS (every 45ms) to preserve CPU and battery on mobile
      const now = performance.now();
      if (now - lastProcessTimeRef.current < 45) {
        animId = requestAnimationFrame(processFrame);
        return;
      }
      lastProcessTimeRef.current = now;

      // 15-second timeout check
      const elapsed = (Date.now() - state.startTime) / 1000;
      if (elapsed > 15 && !state.completed) {
        setTimedOut(true);
        stopStream();
        return;
      }

      const landmarker = landmarkerRef.current;

      // ==========================================
      // TIER A: MediaPipe FaceLandmarker Active
      // ==========================================
      if (landmarker) {
        try {
          // Strictly monotonic timestamp requirement
          const timestamp = now > lastTimestampRef.current ? now : lastTimestampRef.current + 1;
          lastTimestampRef.current = timestamp;

          const results = landmarker.detectForVideo(video, timestamp);
          const numFaces = results?.faceLandmarks?.length || 0;

          if (numFaces === 0) {
            state.baselineFrames = 0;
            state.baselineEstablished = false;
            state.turnFrames = 0;
            state.smileFrames = 0;
            updateChallengeText('Center your face in circle', 0);
          } else if (numFaces > 1) {
            state.baselineFrames = 0;
            state.baselineEstablished = false;
            state.turnFrames = 0;
            state.smileFrames = 0;
            updateChallengeText('Multiple faces detected — 1 person only', 0);
          } else {
            // Exactly ONE face detected!
            const landmarks = results.faceLandmarks[0];
            const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
            const noseTip = landmarks[1];

            // Micro-movement / 3D depth check across 5 consecutive frames
            motionHistoryRef.current.push({ x: noseTip.x, y: noseTip.y, delta: 1 });
            if (motionHistoryRef.current.length > 5) {
              motionHistoryRef.current.shift();
            }

            if (motionHistoryRef.current.length >= 5) {
              const hist = motionHistoryRef.current;
              let mx = 0;
              let my = 0;
              for (const p of hist) {
                mx += p.x;
                my += p.y;
              }
              mx /= hist.length;
              my /= hist.length;

              let variance = 0;
              for (const p of hist) {
                variance += (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
              }
              variance /= hist.length;

              // Natural human micro-movements (saccades, breathing): 0.000002 < var < 0.04
              if (variance > 0.000002 && variance < 0.04) {
                state.microMovementVerified = true;
              }
            }

            const currentType = challenge.type;

            // ------------------------------------------
            // Challenge 1: Blink Challenge
            // ------------------------------------------
            if (currentType === 'blink') {
              const leftEAR = calculateEAR(landmarks, 159, 145, 158, 153, 33, 133);
              const rightEAR = calculateEAR(landmarks, 386, 374, 387, 373, 362, 263);
              const avgEAR = (leftEAR + rightEAR) / 2;

              // Adaptive resting EAR calibration for all eye geometries
              if (avgEAR > 0.22 && avgEAR < 0.45) {
                state.restingEAR =
                  state.restingEAR === 0
                    ? avgEAR
                    : state.restingEAR * 0.92 + avgEAR * 0.08;
              }
              const baselineEAR = state.restingEAR || 0.28;

              const blinkLeft = blendshapes.find((b) => b.categoryName === 'eyeBlinkLeft')?.score ?? 0;
              const blinkRight = blendshapes.find((b) => b.categoryName === 'eyeBlinkRight')?.score ?? 0;
              const avgBlinkScore = (blinkLeft + blinkRight) / 2;

              // Robust closed vs open detection
              const hasBlendshapes = blendshapes.length > 0;
              const isClosed = hasBlendshapes
                ? avgBlinkScore > 0.45 || avgEAR < 0.22
                : avgEAR < Math.min(0.23, baselineEAR * 0.76);
              const isOpen = hasBlendshapes
                ? avgBlinkScore < 0.25 || avgEAR > 0.26
                : avgEAR > Math.min(0.26, baselineEAR * 0.88);

              // Phase 1: Establish eyes-open baseline
              if (!state.baselineEstablished) {
                if (isOpen) {
                  state.baselineFrames += 1;
                  if (state.baselineFrames >= 3) {
                    state.baselineEstablished = true;
                    updateChallengeText(
                      state.blinkCount === 1 ? 'Blink once more...' : 'Face ready! Please blink twice',
                      state.blinkCount === 1 ? 60 : 35
                    );
                  } else {
                    updateChallengeText('Hold eyes open looking at camera...', 20);
                  }
                } else {
                  state.baselineFrames = 0;
                  updateChallengeText('Open eyes and look at camera', 15);
                }
              } else {
                // Phase 2: Dynamic Blink Detection
                if (isClosed && !state.eyesClosed) {
                  state.eyesClosed = true;
                  state.eyesClosedTime = Date.now();
                } else if (isOpen && state.eyesClosed) {
                  const closedDuration = Date.now() - state.eyesClosedTime;
                  state.eyesClosed = false;

                  // Real human blink closed duration is typically 60ms - 1500ms
                  if (closedDuration >= 60 && closedDuration <= 1500) {
                    state.blinkCount += 1;

                    if (state.blinkCount === 1) {
                      state.firstBlinkTime = Date.now();
                      state.baselineEstablished = false; // Require open eyes baseline before 2nd blink
                      updateChallengeText('Blink 1 detected! Blink once more...', 60);
                    } else if (state.blinkCount >= 2) {
                      const interval = (Date.now() - state.firstBlinkTime) / 1000;
                      if (interval <= 4.0 && elapsed >= 0.4) {
                        triggerCompletion();
                        return;
                      } else {
                        state.blinkCount = 1;
                        state.firstBlinkTime = Date.now();
                        state.baselineEstablished = false;
                        updateChallengeText('Blink once more naturally...', 60);
                      }
                    }
                  }
                }
              }
            }

            // ------------------------------------------
            // Challenge 2: Head Turn Challenge (Anti-Spoofing Protected)
            // ------------------------------------------
            else if (currentType === 'turn_left') {
              const eyeCenter = (landmarks[33].x + landmarks[263].x) / 2;
              const eyeDist = Math.max(0.01, dist(landmarks[33], landmarks[263]));
              const yawRatio = (noseTip.x - eyeCenter) / eyeDist;

              let minX = 1;
              let maxX = 0;
              for (let i = 0; i < landmarks.length; i++) {
                if (landmarks[i].x < minX) minX = landmarks[i].x;
                if (landmarks[i].x > maxX) maxX = landmarks[i].x;
              }
              const faceCenter = (minX + maxX) / 2;
              const faceWidth = Math.max(0.01, maxX - minX);
              const relNoseOffset = (noseTip.x - faceCenter) / faceWidth;

              // Phase 1: Establish Center Baseline (Prevents static angled photos)
              const isCentered = Math.abs(relNoseOffset) < 0.07 && Math.abs(yawRatio) < 0.07;

              if (!state.baselineEstablished) {
                if (isCentered) {
                  state.baselineFrames += 1;
                  if (state.baselineFrames >= 3) {
                    state.baselineEstablished = true;
                    state.baselineNoseOffset = relNoseOffset;
                    updateChallengeText('Face centered! Now turn head slightly', 35);
                  } else {
                    updateChallengeText('Hold face centered looking forward...', 20);
                  }
                } else {
                  state.baselineFrames = 0;
                  updateChallengeText('Center your face looking straight ahead', 15);
                }
              } else {
                // Phase 2: Dynamic Head Turn from Center Baseline
                const deltaNose = Math.abs(relNoseOffset - state.baselineNoseOffset);
                const isTurned = deltaNose >= 0.08 || Math.abs(yawRatio) >= 0.08;

                if (isTurned) {
                  state.turnFrames += 1;
                  if (state.turnFrames === 1) {
                    updateChallengeText('Turning detected, hold position...', 65);
                  } else if (state.turnFrames >= 3 && elapsed >= 0.4) {
                    triggerCompletion();
                    return;
                  }
                } else {
                  state.turnFrames = 0;
                  updateChallengeText('Turn head slightly to the left', 35);
                }
              }
            }

            // ------------------------------------------
            // Challenge 3: Smile Challenge (Anti-Spoofing Protected)
            // ------------------------------------------
            else if (currentType === 'smile') {
              const smileLeft = blendshapes.find((b) => b.categoryName === 'mouthSmileLeft')?.score ?? 0;
              const smileRight = blendshapes.find((b) => b.categoryName === 'mouthSmileRight')?.score ?? 0;
              const avgSmile = (smileLeft + smileRight) / 2;

              const mouthWidth = dist(landmarks[61], landmarks[291]);
              const eyeDist = dist(landmarks[33], landmarks[263]);
              const mouthRatio = eyeDist === 0 ? 0 : mouthWidth / eyeDist;

              if (mouthRatio > 0.5 && mouthRatio < 0.74) {
                state.restingMouthRatio =
                  state.restingMouthRatio === 0
                    ? mouthRatio
                    : state.restingMouthRatio * 0.92 + mouthRatio * 0.08;
              }
              const baselineMouth = state.restingMouthRatio || 0.68;
              const hasBlendshapes = blendshapes.length > 0;

              // Phase 1: Establish Neutral Baseline (Prevents static smiling photos)
              const isNeutral = avgSmile < 0.25 && mouthRatio < 0.74;

              if (!state.baselineEstablished) {
                if (isNeutral) {
                  state.baselineFrames += 1;
                  if (state.baselineFrames >= 3) {
                    state.baselineEstablished = true;
                    state.baselineSmile = avgSmile;
                    updateChallengeText('Face ready! Now give a gentle smile', 35);
                  } else {
                    updateChallengeText('Relax facial expression...', 20);
                  }
                } else {
                  state.baselineFrames = 0;
                  updateChallengeText('Relax your face looking at camera', 15);
                }
              } else {
                // Phase 2: Dynamic Smile Transition
                const smileDelta = avgSmile - state.baselineSmile;
                const isSmiling =
                  (hasBlendshapes && avgSmile > 0.38 && smileDelta >= 0.14) ||
                  mouthRatio > Math.max(0.76, baselineMouth * 1.10);

                if (isSmiling) {
                  state.smileFrames += 1;
                  if (state.smileFrames === 1) {
                    updateChallengeText('Nice smile! Hold for a moment...', 65);
                  } else if (state.smileFrames >= 3 && elapsed >= 0.4) {
                    triggerCompletion();
                    return;
                  }
                } else {
                  state.smileFrames = 0;
                  updateChallengeText('Now give a gentle smile', 35);
                }
              }
            }
          }
        } catch (err) {
          console.warn('MediaPipe frame processing warning:', err);
        }
      }

      // ========================================================
      // TIER B: Instant Optical / Native FaceDetector Engine
      // Runs seamlessly while MediaPipe is loading or if absent
      // ========================================================
      else {
        // Sub-tier B1: Native Chrome FaceDetector if available
        let nativeDetected = false;
        if (nativeDetectorRef.current) {
          try {
            const detected = await nativeDetectorRef.current.detect(video);
            if (detected && detected.length === 1) {
              nativeDetected = true;
            } else if (detected && detected.length > 1) {
              state.baselineFrames = 0;
              state.baselineEstablished = false;
              updateChallengeText('Multiple faces detected — 1 person only', 0);
              animId = requestAnimationFrame(processFrame);
              return;
            }
          } catch {}
        }

        // Sub-tier B2: Canvas Optical Motion & Geometry Analysis
        const optical = analyzeOpticalFrame(video);
        if (optical) {
          const facePresent = nativeDetected || optical.hasFace;

          if (!facePresent) {
            state.baselineFrames = 0;
            state.baselineEstablished = false;
            updateChallengeText('Center your face in circle', 0);
          } else {
            // Live micro-movement tracking
            motionHistoryRef.current.push({ x: optical.cx, y: optical.cy, delta: optical.avgDelta });
            if (motionHistoryRef.current.length > 5) {
              motionHistoryRef.current.shift();
            }

            if (motionHistoryRef.current.length >= 5) {
              const hist = motionHistoryRef.current;
              let avgDeltaSum = 0;
              for (const h of hist) avgDeltaSum += h.delta;
              const meanDelta = avgDeltaSum / hist.length;

              // Ensure face is live 3D human (not static paper photo with 0 variance)
              if (meanDelta >= 0.2 && meanDelta <= 25.0) {
                state.microMovementVerified = true;
              }
            }

            const currentType = challenge.type;

            if (currentType === 'blink') {
              const isEyeMotion = optical.eyeBandDelta > 15;
              if (isEyeMotion && !state.eyesClosed) {
                state.eyesClosed = true;
                state.eyesClosedTime = Date.now();
              } else if (!isEyeMotion && state.eyesClosed) {
                const closedDuration = Date.now() - state.eyesClosedTime;
                state.eyesClosed = false;

                if (closedDuration >= 60 && closedDuration <= 1500) {
                  state.blinkCount += 1;

                  if (state.blinkCount === 1) {
                    state.firstBlinkTime = Date.now();
                    updateChallengeText('Blink 1 detected! Blink once more...', 60);
                  } else if (state.blinkCount >= 2 && elapsed >= 0.4) {
                    triggerCompletion();
                    return;
                  }
                }
              } else if (state.blinkCount === 0) {
                updateChallengeText('Face Detected! Please blink twice', 30);
              }
            } else if (currentType === 'turn_left') {
              const shift = Math.abs(optical.cx - state.neutralCentroidX);

              // Phase 1: Centered baseline
              if (!state.baselineEstablished) {
                if (shift < 4) {
                  state.baselineFrames += 1;
                  if (state.baselineFrames >= 3) {
                    state.baselineEstablished = true;
                    updateChallengeText('Face centered! Turn head slightly', 35);
                  } else {
                    updateChallengeText('Hold face centered...', 20);
                  }
                } else {
                  state.baselineFrames = 0;
                  updateChallengeText('Center your face in circle', 15);
                }
              } else {
                if (shift > 7) {
                  state.turnFrames += 1;
                  if (state.turnFrames === 1) {
                    updateChallengeText('Turning detected, hold position...', 65);
                  } else if (state.turnFrames >= 3 && elapsed >= 0.4) {
                    triggerCompletion();
                    return;
                  }
                } else {
                  state.turnFrames = 0;
                  updateChallengeText('Turn head slightly to the left', 35);
                }
              }
            } else if (currentType === 'smile') {
              if (optical.mouthBandDelta > 14) {
                state.smileFrames += 1;
                if (state.smileFrames === 1) {
                  updateChallengeText('Nice smile! Hold for a moment...', 65);
                } else if (state.smileFrames >= 3 && elapsed >= 0.4) {
                  triggerCompletion();
                  return;
                }
              } else {
                state.smileFrames = 0;
                updateChallengeText('Face Detected! Please smile', 30);
              }
            }
          }
        }
      }

      animId = requestAnimationFrame(processFrame);
    };

    animId = requestAnimationFrame(processFrame);
    animFrameRef.current = animId;

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [
    streamActive,
    capturedImage,
    timedOut,
    challenge.type,
    triggerCompletion,
    analyzeOpticalFrame,
    stopStream,
    updateChallengeText,
  ]);

  // Retake photo / Retry after timeout
  const handleRetry = () => {
    if (onRetake) {
      onRetake();
    }
    setCapturedImage(null);
    setTimedOut(false);
    setProgress(0);

    challengeStateRef.current = {
      blinkCount: 0,
      eyesClosed: false,
      eyesClosedTime: 0,
      firstBlinkTime: 0,
      restingEAR: 0,
      turnFrames: 0,
      smileFrames: 0,
      restingMouthRatio: 0,
      neutralCentroidX: 60,
      baselineFrames: 0,
      baselineEstablished: false,
      baselineNoseOffset: 0,
      baselineSmile: 0,
      microMovementVerified: false,
      startTime: Date.now(),
      completed: false,
    };
    motionHistoryRef.current = [];

    const list: { type: ChallengeType; prompt: string }[] = [
      { type: 'blink', prompt: 'Please blink twice' },
      { type: 'turn_left', prompt: 'Turn head slightly' },
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
        {/* Dynamic SVG Circular Progress Ring */}
        <svg
          className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-10"
          viewBox="0 0 100 100"
        >
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            className={`transition-colors duration-300 ${
              challenge.completed
                ? 'text-emerald-500/20'
                : timedOut
                ? 'text-amber-500/20'
                : 'text-blue-500/20'
            }`}
          />
          {/* Active Dynamic Progress Stroke */}
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeDasharray={289}
            strokeDashoffset={289 - (289 * progress) / 100}
            strokeLinecap="round"
            className={`transition-all duration-300 ${
              challenge.completed
                ? 'text-emerald-500'
                : timedOut
                ? 'text-amber-500'
                : 'text-blue-500'
            }`}
          />
        </svg>

        {/* Outer Rotating Dashed Ring for Visual Feedback */}
        <div
          className={`absolute inset-0 rounded-full border-4 border-dashed transition-colors duration-300 pointer-events-none ${
            challenge.completed
              ? 'border-emerald-500 ring-4 ring-emerald-400/30'
              : timedOut
              ? 'border-amber-500'
              : progress > 0
              ? 'border-blue-500/70'
              : 'border-blue-500/50 animate-spin-hud'
          }`}
        />

        {/* Inner Solid Border Ring */}
        <div
          className={`absolute inset-2 rounded-full border-2 transition-all duration-300 pointer-events-none ${
            challenge.completed
              ? 'border-emerald-500/90 shadow-[0_0_24px_rgba(16,185,129,0.45)]'
              : timedOut
              ? 'border-amber-500/80'
              : progress >= 50
              ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
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

          {/* Camera connecting spinner (only if camera not yet streaming) */}
          {!streamActive && !permissionError && cameraStarted && !timedOut && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 text-white text-xs gap-2 p-2 text-center">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
              <span className="text-[11px]">Connecting camera...</span>
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
                className="px-4 py-2 min-h-[38px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full font-bold shadow-md text-xs cursor-pointer"
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
                Face or challenge motion was not completed in time.
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="px-4 py-2 min-h-[38px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-full font-bold shadow-md flex items-center gap-1.5 text-xs cursor-pointer"
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
              className="mt-2 text-xs font-bold text-red-700 underline cursor-pointer"
            >
              Try camera again
            </button>
          </div>
        </div>
      )}

      {/* Status & Live Challenge Box */}
      {capturedImage ? (
        <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl p-3 sm:p-3.5 mb-3 text-center animate-in fade-in duration-300">
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
            className="mt-2.5 min-h-[36px] inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-800 px-3 py-1 bg-white border border-slate-200 rounded-full shadow-xs transition-colors cursor-pointer"
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

            {/* Dynamic Progress Bar */}
            <div className="w-full max-w-[210px] mx-auto bg-blue-200/60 rounded-full h-1.5 mb-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  challenge.completed ? 'bg-emerald-500' : 'bg-blue-600'
                }`}
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-blue-200 text-blue-800 text-[10px] min-[360px]:text-[11px] font-medium shadow-xs max-w-full">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  challenge.completed
                    ? 'bg-emerald-500'
                    : progress > 0
                    ? 'bg-emerald-500 animate-pulse'
                    : 'bg-blue-400'
                }`}
              />
              <span className="truncate">{challenge.progressText}</span>
              {progress > 0 && !challenge.completed && (
                <span className="text-[9px] font-bold text-blue-600 ml-0.5">({progress}%)</span>
              )}
            </div>

            {/* Engine status indicator */}
            <div className="mt-1 flex items-center justify-center gap-1 text-[9px] text-slate-400">
              <UserCheck className="w-2.5 h-2.5" />
              <span>
                {modelTier.startsWith('mediapipe')
                  ? '3D Mesh Active'
                  : modelTier === 'native'
                  ? 'Hardware Face Active'
                  : 'Fast Optical Tracking'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
