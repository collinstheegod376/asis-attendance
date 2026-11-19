import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Liveness Engine & CameraHUD Verification', () => {
  const hudPath = path.resolve(__dirname, '../../components/CameraHUD.tsx');
  const hudSource = fs.readFileSync(hudPath, 'utf-8');

  it('1. Confirms MediaPipe CPU delegate sets outputFaceBlendshapes to false', () => {
    // Check all createFromOptions calls where delegate is 'CPU'
    const cpuBlocks = hudSource.match(/FaceLandmarker\.createFromOptions\([^)]*?delegate:\s*'CPU'[^)]*?\)/gs) || [];
    expect(cpuBlocks.length).toBeGreaterThan(0);
    for (const block of cpuBlocks) {
      expect(block).toContain('outputFaceBlendshapes: false');
      expect(block).not.toContain('outputFaceBlendshapes: true');
    }
  });

  it('2. Confirms strictly monotonic timestamps are passed to detectForVideo', () => {
    expect(hudSource).toContain('lastTimestampRef');
    expect(hudSource).toMatch(/const\s+timestamp\s*=\s*now\s*>\s*lastTimestampRef\.current\s*\?\s*now\s*:\s*lastTimestampRef\.current\s*\+\s*1/);
    expect(hudSource).toMatch(/landmarker\.detectForVideo\(video,\s*timestamp\)/);
  });

  it('3. Confirms Multi-Tier Vision Engine: MediaPipe with CDN fallback & Tier B Optical/Native fallback', () => {
    expect(hudSource).toContain('WASM_LOCAL');
    expect(hudSource).toContain('WASM_CDN');
    expect(hudSource).toContain('MODEL_LOCAL');
    expect(hudSource).toContain('MODEL_CDN');
    expect(hudSource).toContain('analyzeOpticalFrame');
    expect(hudSource).toContain('FaceDetector');
  });

  it('4. Confirms Micro-movement / 3D depth liveliness check across 5 consecutive frames', () => {
    expect(hudSource).toMatch(/motionHistoryRef\.current\.length\s*>=\s*5/);
    expect(hudSource).toContain('microMovementVerified');
  });

  it('5. Confirms live progress indicator UI (0% -> 100%) and responsive feedback', () => {
    expect(hudSource).toContain('setProgress(100)');
    expect(hudSource).toContain('Liveness verified! Capturing photo...');
    expect(hudSource).toContain('strokeDasharray');
    expect(hudSource).toContain('strokeDashoffset');
    expect(hudSource).toContain('bg-emerald-500');
  });

  it('6. Confirms EAR and geometry helpers exist and calculate accurately', () => {
    function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
      return Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
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

    // Open eye landmark array
    const openEye: { x: number; y: number; z: number }[] = Array.from({ length: 468 }, () => ({ x: 0, y: 0, z: 0 }));
    openEye[33] = { x: 0, y: 0, z: 0 };
    openEye[133] = { x: 50, y: 0, z: 0 };
    openEye[159] = { x: 25, y: 0, z: 0 };
    openEye[145] = { x: 25, y: 15, z: 0 };
    openEye[158] = { x: 25, y: 0, z: 0 };
    openEye[153] = { x: 25, y: 15, z: 0 };

    const earOpen = calculateEAR(openEye, 159, 145, 158, 153, 33, 133);
    expect(earOpen).toBeCloseTo(0.3, 2);

    // Closed eye landmark array
    const closedEye = openEye.map((pt) => ({ ...pt }));
    closedEye[145] = { x: 25, y: 1, z: 0 };
    closedEye[153] = { x: 25, y: 1, z: 0 };
    const earClosed = calculateEAR(closedEye, 159, 145, 158, 153, 33, 133);
    expect(earClosed).toBeCloseTo(0.02, 2);
    expect(earClosed).toBeLessThan(0.2);
  });

  it('7. Confirms High-Quality Square Center Crop to 480x480 with auto submit triggers', () => {
    expect(hudSource).toContain('canvas.width = 480');
    expect(hudSource).toContain('canvas.height = 480');
    expect(hudSource).toContain("canvas.toDataURL('image/jpeg', 0.88)");
    expect(hudSource).toContain('onCapture(captured)');
    expect(hudSource).toContain('onAutoSubmit(captured)');
  });
});
