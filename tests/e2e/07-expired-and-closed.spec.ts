import { test, expect } from '@playwright/test';

/**
 * Test 07 - Temporal Enforcement: Expired and Closed Sessions
 * Covers: QA-13, QA-15, SEC-11, SEC-20
 * - Join token on an expired session redirects to /expired
 * - Explicit lecturer session closure redirects to /closed
 * - Late submission attempt returns 4xx ATTEMPT_EXPIRED and redirects to /expired
 */
test.describe('07 - Expired & Closed Session Handling', () => {
  test('session duration expiry redirects to /expired', async ({ page }) => {
    const expiredToken = process.env.TEST_EXPIRED_SESSION_TOKEN || 'adun-expired-session-csc201';

    await page.goto(`/join/${expiredToken}`);

    // Must navigate to /expired terminal state with replace: true
    await page.waitForURL('**/expired*', { timeout: 10000 });
    await expect(page.locator('text=Session Expired, text=Attendance Window Closed').first()).toBeVisible();

    // Verify back navigation doesn't retain stale attempt state
    await page.goBack();
    expect(page.url()).toContain('/expired');
  });

  test('lecturer closing session redirects student to /closed', async ({ page }) => {
    const closedToken = process.env.TEST_CLOSED_SESSION_TOKEN || 'adun-closed-session-csc201';

    await page.goto(`/join/${closedToken}`);

    // Must navigate to /closed terminal state
    await page.waitForURL('**/closed*', { timeout: 10000 });
    await expect(page.locator('text=Session Closed, text=This lecture has been concluded').first()).toBeVisible();
  });

  test('attempt submission past expiry receives 4xx ATTEMPT_EXPIRED', async ({ page, context }) => {
    // Start on a valid session
    const ephemeralToken = 'adun-ephemeral-session-token';
    await context.grantPermissions(['geolocation', 'camera']);
    await context.setGeolocation({ latitude: 6.3350, longitude: 5.6037 });

    await page.goto(`/join/${ephemeralToken}`);
    await page.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue")');
    await page.waitForURL('**/attend/location');

    // Fast-forward past session window
    await page.clock.fastForward(60 * 60 * 1000); // 1 hour

    // Try to proceed
    await page.click('button:has-text("Verify My Location")');

    // Must navigate to /expired on ATTEMPT_EXPIRED / SESSION_EXPIRED
    await page.waitForURL('**/expired*', { timeout: 10000 });
    await expect(page.locator('text=Session Expired, text=Attempt Expired').first()).toBeVisible();
  });
});
