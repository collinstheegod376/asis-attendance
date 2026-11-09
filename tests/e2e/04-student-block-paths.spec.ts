import { test, expect } from '@playwright/test';

/**
 * Test 04 - Student Security Enforcement & Block Screens
 * Covers: SEC-04, SEC-05, SEC-06, QA-04, QA-14
 * - Private / Incognito browser detection -> BIND-205 (OPEN_NORMAL_BROWSER)
 * - Shared device attempt with different student -> BIND-202 (CONTACT_ADMIN)
 * - Device with cleared cookies / missing state -> BIND-204 (CONTACT_ADMIN)
 * - Verification that all block pages present the exact hexadecimal reference code
 */
test.describe('04 - Security Block Paths & Reference Taxonomy', () => {
  const sessionToken = process.env.TEST_ACTIVE_SESSION_TOKEN || 'adun-live-session-csc201';

  test('incognito browsing triggers BIND-205 block screen', async ({ browser }) => {
    // 1. Launch a clean incognito context with private browsing signal enabled
    const incognitoContext = await browser.newContext();
    const page = await incognitoContext.newPage();

    // Inject simulated private browsing storage quota quota limitation
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'storage', {
        value: {
          estimate: async () => ({ quota: 120000000, usage: 1000 }), // Characteristic < 120MB private quota
        },
      });
      // Emulate incognito signal
      (window as any).__ADUN_TEST_INCOGNITO__ = true;
    });

    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i], input[name="matric"]', 'U2024/CS/1001');

    const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await continueBtn.click();

    // Must navigate to /block/incognito
    await page.waitForURL('**/block/incognito*', { timeout: 10000 });
    await expect(page.locator('text=Incognito Mode Detected, text=Private Browsing Not Permitted').first()).toBeVisible();

    // Must display reference code BIND-205 with hex suffix
    const refCode = page.locator('[data-testid="ref-code"], text=BIND-205');
    await expect(refCode.first()).toBeVisible();
    await expect(refCode.first()).toHaveText(/BIND-205(-[0-9A-Fa-f]{4})?/);

    await incognitoContext.close();
  });

  test('multiple students on single physical device triggers BIND-202 collision', async ({ page }) => {
    // 1. Student A completes initial device binding
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i], input[name="matric"]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await page.waitForURL('**/attend/location', { timeout: 10000 });

    // 2. Student B attempts to use the SAME device for the same or next session
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i], input[name="matric"]', 'U2024/CS/1002');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');

    // Must be blocked with BIND-202 (device bound to another student)
    await page.waitForURL('**/block/device-in-use*|**/block/contact-admin*', { timeout: 10000 });
    await expect(page.locator('text=Device Registered to Another Student, text=Device In Use, text=Contact Administrator').first()).toBeVisible();

    const refCode = page.locator('[data-testid="ref-code"], text=BIND-202');
    await expect(refCode.first()).toBeVisible();
    await expect(refCode.first()).toHaveText(/BIND-202(-[0-9A-Fa-f]{4})?/);
  });

  test('cleared cookies with matching hardware fingerprint triggers BIND-204', async ({ page, context }) => {
    // 1. Initial binding for Student A
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i], input[name="matric"]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await page.waitForURL('**/attend/location', { timeout: 10000 });

    // 2. Student clears cookies and localStorage (simulating browser reset or cookie tampering)
    await context.clearCookies();
    await page.evaluate(() => localStorage.clear());

    // 3. Student tries to access again on the same hardware
    await page.goto(`/join/${sessionToken}`);
    await page.fill('input[placeholder*="Matric" i], input[name="matric"]', 'U2024/CS/1001');
    await page.click('button:has-text("Continue"), button:has-text("Confirm Identity")');

    // Must be blocked with BIND-204 (Missing cookie on known fingerprint)
    await page.waitForURL('**/block/contact-admin*|**/block/unrecognized*', { timeout: 10000 });
    const refCode = page.locator('[data-testid="ref-code"], text=BIND-204');
    await expect(refCode.first()).toBeVisible();
    await expect(refCode.first()).toHaveText(/BIND-204(-[0-9A-Fa-f]{4})?/);
  });
});
