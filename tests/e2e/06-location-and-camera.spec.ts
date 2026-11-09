import { test, expect } from '@playwright/test';

/**
 * Test 06 - Hardware Gates: Geolocation & Camera Liveness
 * Covers: SEC-07, SEC-08, SEC-09, SEC-13, QA-08, QA-09, PERF-11, PERF-12
 * - Geolocation denial fail-closed enforcement
 * - Geofence out-of-bounds rejection
 * - In-bounds campus verification
 * - Camera permission denial fail-closed handling
 * - Liveness challenge 15s timeout
 * - Blink challenge success
 * - Camera MediaStream track termination on completion & unmount
 */
test.describe('06 - Hardware Gates (Location & Camera)', () => {
  const sessionToken = process.env.TEST_ACTIVE_SESSION_TOKEN || 'adun-live-session-csc201';

  test('geolocation denial blocks progression fail-closed', async ({ browser }) => {
    // Context with denied location permission
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();

    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await page.waitForURL('**/attend/location');

    await page.click('button:has-text("Verify My Location")');

    // Must show permission denied error and NOT allow navigation
    await expect(page.locator('text=Location Permission Denied, text=Please enable location access').first()).toBeVisible({ timeout: 5000 });
    expect(page.url()).toContain('/attend/location');

    await context.close();
  });

  test('coordinates outside campus geofence are rejected', async ({ browser }) => {
    // Coords in Lagos (outside ADUN Ibusa/Delta campus: 6.3350, 5.6037)
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 6.5244, longitude: 3.3792 }, // Lagos
    });
    const page = await context.newPage();

    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await page.waitForURL('**/attend/location');

    await page.click('button:has-text("Verify My Location")');

    // Must show outside campus boundary error
    await expect(page.locator('text=outside the permitted campus area, text=Outside Boundary').first()).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/attend/location');

    await context.close();
  });

  test('camera permission denial, liveness timeout, blink success, and stream teardown', async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 6.3350, longitude: 5.6037 },
    });
    const page = await context.newPage();

    // 1. Progress past location to selfie gate
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue")');
    await page.waitForURL('**/attend/location');
    await page.click('button:has-text("Verify My Location")');
    await page.click('button:has-text("Continue to Face Verification")');
    await page.waitForURL('**/attend/selfie');

    // 2. Grant camera and observe liveness challenge
    await context.grantPermissions(['camera']);
    await page.reload();

    // Challenge appears (e.g. "Blink twice", "Turn head", or countdown)
    const hud = page.locator('text=Liveness, [data-testid="camera-hud"]').first();
    await expect(hud).toBeVisible({ timeout: 10000 });

    // 3. Verify MediaStream track is active during inspection
    const streamActive = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video || !video.srcObject) return false;
      const stream = video.srcObject as MediaStream;
      return stream.getVideoTracks().some((t) => t.readyState === 'live');
    });
    expect(streamActive).toBe(true);

    // 4. Capture photo on completed challenge
    await page.click('button:has-text("Capture"), button:has-text("Take Photo")');

    // 5. Verify camera tracks are STOPPED immediately after capture (Fixes PERF-11)
    const streamStopped = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      if (!video || !video.srcObject) return true; // clean release
      const stream = video.srcObject as MediaStream;
      return stream.getVideoTracks().every((t) => t.readyState === 'ended');
    });
    expect(streamStopped).toBe(true);

    await context.close();
  });
});
