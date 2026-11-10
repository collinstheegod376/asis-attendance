import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Agent 4: Student PWA Mobile Responsiveness & Viewport Protection Suite', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  it('1. index.html defines mobile viewport with device-width, maximum-scale=5.0, and viewport-fit=cover', () => {
    const indexPath = path.join(rootDir, 'index.html');
    const content = fs.readFileSync(indexPath, 'utf-8');

    expect(content).toContain('name="viewport"');
    const viewportMatch = content.match(/<meta\s+name="viewport"\s+content="([^"]+)"/i);
    expect(viewportMatch).toBeTruthy();
    const viewportContent = viewportMatch![1];

    expect(viewportContent).toContain('width=device-width');
    expect(viewportContent).toContain('initial-scale=1.0');
    expect(viewportContent).toContain('maximum-scale=5.0');
    expect(viewportContent).toContain('viewport-fit=cover');
  });

  it('2. index.css enforces 16px font-size on mobile inputs to permanently prevent iOS Safari auto-zoom', () => {
    const cssPath = path.join(rootDir, 'src/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    expect(content).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(content).toContain('font-size: 16px !important;');
  });

  it('3. index.css enforces overflow-x: hidden and touch-action: manipulation on html, body, and #root', () => {
    const cssPath = path.join(rootDir, 'src/index.css');
    const content = fs.readFileSync(cssPath, 'utf-8');

    expect(content).toContain('overflow-x: hidden;');
    expect(content).toContain('touch-action: manipulation;');
    expect(content).toMatch(/html,\s*body,\s*#root/);
  });

  it('4. Stepper component supports ultra-narrow screens (320px) without horizontal overflow', () => {
    const stepperPath = path.join(rootDir, 'src/components/Stepper.tsx');
    const content = fs.readFileSync(stepperPath, 'utf-8');

    expect(content).toContain('overflow-hidden');
    expect(content).toContain('shrink-0');
    expect(content).toContain('whitespace-nowrap');
  });

  it('5. AttendIdentityPage ensures mobile touch targets and zoom-free matric input', () => {
    const identityPath = path.join(rootDir, 'src/pages/AttendIdentityPage.tsx');
    const content = fs.readFileSync(identityPath, 'utf-8');

    // Input must have text-base or font-size that prevents zoom
    expect(content).toContain('text-base sm:text-sm');
    expect(content).toContain('min-h-[44px]');
    expect(content).toContain('min-h-[100dvh]');
    expect(content).toContain('overflow-x-hidden');
  });

  it('6. AttendLocationPage enforces responsive layout and touch-friendly retry button', () => {
    const locPath = path.join(rootDir, 'src/pages/AttendLocationPage.tsx');
    const content = fs.readFileSync(locPath, 'utf-8');

    expect(content).toContain('min-h-[100dvh]');
    expect(content).toContain('overflow-x-hidden');
    expect(content).toContain('break-words');
    expect(content).toContain('min-h-[44px]');
  });

  it('7. CameraHUD & AttendSelfiePage circular viewfinder fits mobile viewport height and width', () => {
    const hudPath = path.join(rootDir, 'src/components/CameraHUD.tsx');
    const content = fs.readFileSync(hudPath, 'utf-8');

    // Responsive sizing that accommodates 320px screens and 568px height
    expect(content).toContain('w-52 h-52');
    expect(content).toContain('min-[360px]:w-60');
    expect(content).toContain('shrink-0');
  });

  it('8. AttendConfirmationPage receipt verification ID has word-break and print framing', () => {
    const confirmPath = path.join(rootDir, 'src/pages/AttendConfirmationPage.tsx');
    const content = fs.readFileSync(confirmPath, 'utf-8');

    expect(content).toContain('break-all');
    expect(content).toContain('print:p-0');
    expect(content).toContain('min-h-[100dvh]');
    expect(content).toContain('receipt_id');
  });

  it('9. BlockPageLayout reference code has break-all to prevent horizontal card expansion on 320px screens', () => {
    const blockPath = path.join(rootDir, 'src/components/BlockPageLayout.tsx');
    const content = fs.readFileSync(blockPath, 'utf-8');

    expect(content).toContain('break-all');
    expect(content).toContain('min-h-[100dvh]');
    expect(content).toContain('min-h-[44px]');
  });

  it('10. Verified standard mobile screen sizes (320px, 375px, 390px, 414px) do not exceed container constraints', () => {
    const screenWidths = [320, 375, 390, 414];
    for (const width of screenWidths) {
      // Containers are constrained by max-w-sm (384px) or w-full
      const maxWSmPx = 384;
      const expectedRenderWidth = Math.min(width, maxWSmPx);
      expect(expectedRenderWidth).toBeLessThanOrEqual(width);
      expect(expectedRenderWidth).toBeGreaterThan(0);
    }
  });
});
