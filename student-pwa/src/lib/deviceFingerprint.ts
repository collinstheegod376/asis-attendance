/**
 * ADUN Attendance - Strict Client Device Fingerprinting & Gate 0 Incognito Detection
 * Option 2: Deterministic device fingerprinting (Canvas, WebGL, Screen, Concurrency, Audio, Timezone, Platform)
 * Fail-closed policy: Returns code BIND-200 if fingerprint generation fails or is blocked by ad-blockers.
 * Fixes: PERF-15, SEC-19
 */

export interface FingerprintResult {
  success: boolean;
  hash: string;
  code?: 'BIND-200';
  error?: string;
  components?: Record<string, unknown>;
}

/**
 * Computes deterministic 2D Canvas rendering hash
 */
function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }

    // Background rectangle
    ctx.fillStyle = '#1E40AF';
    ctx.fillRect(0, 0, 280, 60);

    // Text with shadow and font variation
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#F59E0B';
    ctx.shadowBlur = 6;
    ctx.fillText('ADUN Attendance Verification 🎓⚓', 10, 8);

    // Geometric curves & alpha blending
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(240, 30, 20, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#93C5FD';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(10, 42);
    ctx.bezierCurveTo(70, 58, 140, 26, 210, 46);
    ctx.stroke();

    const dataUrl = canvas.toDataURL();
    if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 50) {
      throw new Error('Canvas data URL empty or blocked by ad-blocker');
    }

    return dataUrl;
  } catch (err) {
    throw new Error('CANVAS_FINGERPRINT_FAILED: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Extracts WebGL vendor, renderer and capabilities
 */
function getWebGLFingerprint(): Record<string, unknown> {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      return { supported: false };
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    return {
      supported: true,
      vendor: String(vendor || 'unknown'),
      renderer: String(renderer || 'unknown'),
      version: String(gl.getParameter(gl.VERSION) || ''),
      shadingLanguage: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || ''),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0,
    };
  } catch {
    return { supported: false, error: 'WEBGL_QUERY_FAILED' };
  }
}

/**
 * Computes deterministic audio dynamics compressor fingerprint
 * Reduced to 5000 samples (Fixes PERF-15)
 */
async function getAudioFingerprint(): Promise<string> {
  try {
    const AudioContextClass =
      window.OfflineAudioContext ||
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!AudioContextClass) {
      return 'AUDIO_UNSUPPORTED';
    }

    // Reduced from 44100 to 5000 samples for performance and consistency
    const context = new AudioContextClass(1, 5000, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(10000, context.currentTime);

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-50, context.currentTime);
    compressor.knee.setValueAtTime(40, context.currentTime);
    compressor.ratio.setValueAtTime(12, context.currentTime);
    compressor.attack.setValueAtTime(0, context.currentTime);
    compressor.release.setValueAtTime(0.25, context.currentTime);

    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);

    const renderedBuffer = await context.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    // Sample-based hash calculation
    let sum = 0;
    const step = 10;
    for (let i = 4500; i < 5000; i += step) {
      sum += Math.abs(channelData[i] || 0);
    }
    return 'audio_' + sum.toFixed(7);
  } catch {
    return 'AUDIO_POLICY_RESTRICTED';
  }
}

/**
 * Orientation-invariant screen dimensions (Fixes PERF-15)
 * Uses Math.min and Math.max so phone rotation does not change the fingerprint hash.
 */
function getScreenInfo(): Record<string, unknown> {
  const w = window.screen.width || 0;
  const h = window.screen.height || 0;
  const aw = window.screen.availWidth || 0;
  const ah = window.screen.availHeight || 0;

  return {
    minDimension: Math.min(w, h),
    maxDimension: Math.max(w, h),
    minAvailDimension: Math.min(aw, ah),
    maxAvailDimension: Math.max(aw, ah),
    colorDepth: window.screen.colorDepth,
    pixelDepth: window.screen.pixelDepth,
    pixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * Hardware concurrency and memory
 */
function getHardwareInfo(): Record<string, unknown> {
  const nav = navigator as unknown as { deviceMemory?: number };
  return {
    concurrency: navigator.hardwareConcurrency || 1,
    deviceMemory: nav.deviceMemory || 0,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  };
}

/**
 * Timezone and Locale information
 */
function getTimezoneInfo(): Record<string, unknown> {
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown',
    offset: new Date().getTimezoneOffset(),
    language: navigator.language || 'en',
    languages: (navigator.languages || []).join(','),
  };
}

/**
 * Platform and operating system details
 */
function getPlatformInfo(): Record<string, unknown> {
  return {
    platform: navigator.platform || 'unknown',
    userAgent: navigator.userAgent || 'unknown',
  };
}

/**
 * Generates deterministic SHA-256 device fingerprint hash.
 * FAIL-CLOSED: Returns code 'BIND-200' if blocked or generation fails.
 */
export async function generateDeviceFingerprint(): Promise<FingerprintResult> {
  try {
    if (!window.crypto || !window.crypto.subtle) {
      return {
        success: false,
        hash: '',
        code: 'BIND-200',
        error: 'Web Crypto API unavailable or blocked in this browser.',
      };
    }

    // 1. Gather all components
    const canvasFp = getCanvasFingerprint();
    const webglFp = getWebGLFingerprint();
    const audioFp = await getAudioFingerprint();
    const screenFp = getScreenInfo();
    const hardwareFp = getHardwareInfo();
    const timezoneFp = getTimezoneInfo();
    const platformFp = getPlatformInfo();

    const components = {
      canvas: canvasFp,
      webgl: webglFp,
      audio: audioFp,
      screen: screenFp,
      hardware: hardwareFp,
      timezone: timezoneFp,
      platform: platformFp,
    };

    // 2. Canonical serialization
    const canonicalString = JSON.stringify(components, Object.keys(components).sort());

    // 3. SHA-256 Digest
    const encoder = new TextEncoder();
    const data = encoder.encode(canonicalString);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    return {
      success: true,
      hash: hashHex,
      components,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Device fingerprint generation failed (fail-closed):', errorMsg);
    return {
      success: false,
      hash: '',
      code: 'BIND-200',
      error: errorMsg,
    };
  }
}

/**
 * GATE 0: Incognito / Private Browsing Detector
 * Uses storage quota, storage persistence, WebKit filesystem and Firefox IndexedDB heuristics.
 */
export async function detectIncognito(): Promise<boolean> {
  try {
    // 1. Quota check (Chromium: Chrome, Edge, Brave, Opera)
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const { quota } = await navigator.storage.estimate();
        // In Chromium Incognito, quota is restricted (typically <= 120MB)
        if (typeof quota === 'number' && quota > 0 && quota < 120 * 1024 * 1024) {
          return true;
        }
      } catch {
        // Continue to other heuristics
      }
    }

    // 2. Storage Persistence Check
    if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
      try {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          const canPersist = await navigator.storage.persist();
          if (!canPersist && navigator.userAgent.includes('Chrome')) {
            // Strong auxiliary signal in desktop Chrome
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. WebKit Temporary Storage / RequestFileSystem API (Legacy Chromium & Safari)
    try {
      const fs = (window as unknown as { webkitRequestFileSystem?: unknown; RequestFileSystem?: unknown })
        .webkitRequestFileSystem;
      if (typeof fs === 'function') {
        const isPrivate = await new Promise<boolean>((resolve) => {
          (fs as (type: number, size: number, success: () => void, error: () => void) => void)(
            0, // TEMPORARY
            100,
            () => resolve(false),
            () => resolve(true)
          );
        });
        if (isPrivate) return true;
      }
    } catch {
      // ignore
    }

    // 4. Firefox IndexedDB Private Mode Check
    try {
      if ('MozAppearance' in document.documentElement.style) {
        const isPrivate = await new Promise<boolean>((resolve) => {
          const req = indexedDB.open('adun_incognito_probe');
          req.onerror = () => resolve(true);
          req.onsuccess = () => resolve(false);
        });
        if (isPrivate) return true;
      }
    } catch {
      // ignore
    }

    // 5. Safari Private Browsing Quota Check
    try {
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (isSafari) {
        try {
          const testKey = '__adun_pvt_test__';
          localStorage.setItem(testKey, '1');
          localStorage.removeItem(testKey);
        } catch (e: unknown) {
          const err = e as { code?: number; name?: string };
          if (err && (err.code === 22 || err.name === 'QuotaExceededError')) {
            return true;
          }
        }
      }
    } catch {
      // ignore
    }

    return false;
  } catch {
    return false;
  }
}
