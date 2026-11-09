import { test, expect } from '@playwright/test';

/**
 * Test 08 - Cross-Browser Engine Smoke Verification
 * Covers: Chromium (Blink), Firefox (Gecko), WebKit (Safari)
 * Validates core attendance check-in (Test 03) and security blocking (Test 04)
 * across the 3 primary browser rendering engines.
 */
test.describe('08 - Cross-Browser Smoke Matrix', () => {
  const sessionToken = process.env.TEST_ACTIVE_SESSION_TOKEN || 'adun-live-session-csc201';

  test('happy path attendance functions identically across browser engines', async ({ page, context, browserName }) => {
    test.info().annotations.push({
      type: 'engine',
      description: `Testing on browser engine: ${browserName}`,
    });

    await context.grantPermissions(['geolocation', 'camera']);
    await context.setGeolocation({ latitude: 6.3350, longitude: 5.6037 });

    // 1. Join session
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');

    const identityCard = page.locator('text=Adeyemi Chinedu, [data-testid="identity-card"]').first();
    await expect(identityCard).toBeVisible({ timeout: 8000 });
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');

    // 2. Geolocation gate
    await page.waitForURL('**/attend/location', { timeout: 10000 });
    await page.click('button:has-text("Verify My Location")');
    await expect(page.locator('text=Inside Campus, text=Location Verified').first()).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Continue to Face Verification")');

    // 3. Selfie & Liveness gate
    await page.waitForURL('**/attend/selfie', { timeout: 10000 });
    const captureBtn = page.locator('button:has-text("Capture"), button:has-text("Take Photo")');
    await expect(captureBtn).toBeEnabled({ timeout: 15000 });
    await captureBtn.click();
    await page.click('button:has-text("Continue to Instructions")');

    // 4. Video step to confirmed receipt
    await page.waitForURL('**/attend/video', { timeout: 10000 });
    await page.click('button:has-text("Submit Attendance")');

    await page.waitForURL('**/attend/confirmed', { timeout: 15000 });
    await expect(page.locator('text=Attendance Recorded, text=Verified Receipt').first()).toBeVisible();
  });

  test('security collision block behaves identically across browser engines', async ({ page, browserName }) => {
    test.info().annotations.push({
      type: 'engine',
      description: `Testing BIND-202 on browser engine: ${browserName}`,
    });

    // Device with existing student binding
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue")');
    await page.waitForURL('**/attend/location');

    // Attempt second student
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1002');
    await page.click('button:has-text("Continue")');

    // Expect navigation to block page with BIND-202
    await page.waitForURL('**/block/*', { timeout: 10000 });
    await expect(page.locator('text=BIND-202').first()).toBeVisible();
  });
});
