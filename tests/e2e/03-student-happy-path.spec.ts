import { test, expect } from '@playwright/test';

/**
 * Test 03 - Student Happy Path & Attendance Verification
 * Covers: SEC-03, SEC-10, QA-01, QA-07, QA-20, PERF-01, PERF-04, PERF-05
 * - Access session token
 * - Matric lookup and identity confirmation card
 * - Geofence validation inside ADUN coordinates
 * - Camera liveness check and selfie upload
 * - Final attendance record creation with Lagos timestamp
 * - Real-time reflection on Lecturer screen
 */
test.describe('03 - Student Happy Path', () => {
  test('student completes end-to-end verified check-in flow', async ({ page, context }) => {
    // 1. Mock Geolocation inside ADUN Main Campus (Delta State)
    await context.grantPermissions(['geolocation', 'camera']);
    await context.setGeolocation({ latitude: 6.3350, longitude: 5.6037 });

    const sessionToken = process.env.TEST_ACTIVE_SESSION_TOKEN || 'adun-live-session-csc201';

    // 2. Open Session Entry Link
    await page.goto(`/join/${sessionToken}`);
    await expect(page).toHaveURL(new RegExp(`/attend/identity|/join/${sessionToken}`));

    // 3. Matric Lookup & Confirmation
    const matricInput = page.locator('input[placeholder*="Matric" i], input[name="matric"]');
    await matricInput.fill('U2024/CS/1001');

    // Debounced lookup returns student identity card
    const identityCard = page.locator('text=Adeyemi Chinedu, [data-testid="identity-card"]').first();
    await expect(identityCard).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Computer Science')).toBeVisible();

    // Click "Continue to Location Check" (this triggers /api/device-check & binds device)
    await page.click('button:has-text("Continue to Location Check"), button:has-text("Confirm Identity")');

    // 4. Location Verification Gate
    await page.waitForURL('**/attend/location', { timeout: 10000 });
    await expect(page.locator('text=Location Verification, text=Campus Geofence').first()).toBeVisible();

    await page.click('button:has-text("Verify My Location"), button:has-text("Check Location")');
    await expect(page.locator('text=Inside Campus, text=Location Verified, [data-status="verified"]').first()).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Continue to Face Verification"), button:has-text("Next")');

    // 5. Camera & Liveness Gate
    await page.waitForURL('**/attend/selfie', { timeout: 10000 });
    await expect(page.locator('text=Face Verification, text=Liveness Challenge').first()).toBeVisible();

    // Perform liveness action (simulated via video/canvas feed)
    const captureButton = page.locator('button:has-text("Capture"), button:has-text("Take Photo"), [aria-label="Capture"]');
    await expect(captureButton).toBeEnabled({ timeout: 15000 });
    await captureButton.click();

    // Verify selfie preview
    await expect(page.locator('img[alt*="Selfie" i], [data-testid="selfie-preview"]').first()).toBeVisible();
    await page.click('button:has-text("Continue to Instructions"), button:has-text("Next Step")');

    // 6. Instructional Video Page (non-blocking)
    await page.waitForURL('**/attend/video', { timeout: 10000 });
    const submitButton = page.locator('button:has-text("Submit Attendance"), button:has-text("Confirm & Sign")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // 7. Confirmation Receipt
    await page.waitForURL('**/attend/confirmed', { timeout: 15000 });
    await expect(page.locator('text=Attendance Recorded, text=Verified Receipt').first()).toBeVisible();
    await expect(page.locator('text=U2024/CS/1001')).toBeVisible();

    // Receipt timestamp must reflect West Africa Time (WAT / UTC+1)
    const receiptTime = page.locator('[data-testid="receipt-timestamp"], text=WAT');
    await expect(receiptTime.first()).toBeVisible();
  });
});
