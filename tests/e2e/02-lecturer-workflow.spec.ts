import { test, expect } from '@playwright/test';

/**
 * Test 02 - Lecturer Workflow & Course Management
 * Covers: QA-02, QA-12, QA-16, QA-17, PERF-16
 * - Lecturer authentication & course scoping
 * - Roster upload with strict rejection of unknown matric numbers
 * - Scheduled session creation & time-based transition to Active Live
 * - Dynamic QR code presentation
 */
test.describe('02 - Lecturer Workflow', () => {
  test('lecturer views course, uploads roster with strict validation, schedules session', async ({ page }) => {
    // 1. Login as Lecturer
    await page.goto('/login');
    await page.fill('input[name="email"]', 'lecturer@adun.edu.ng');
    await page.fill('input[name="password"]', 'Lecturer123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/lecturer/dashboard', { timeout: 15000 });

    // 2. Locate assigned course
    const courseCard = page.locator('text=CSC201, text=Computer Programming').first();
    await expect(courseCard).toBeVisible();
    await courseCard.click();

    // 3. Navigate to Roster Import
    await page.click('button:has-text("Roster"), [role="tab"]:has-text("Roster")');
    await page.click('button:has-text("Import Roster"), button:has-text("Upload CSV")');

    // 4. Upload CSV with 3 valid students + 1 unknown student
    const csvContent = [
      'Matric Number,Full Name,Department',
      'U2024/CS/1001,Adeyemi Chinedu,Computer Science',
      'U2024/CS/1002,Bello Fatima,Computer Science',
      'U2024/CS/1003,Chukwu Emeka,Computer Science',
      'U9999/XX/9999,Unknown Intruder,Unregistered Dept',
    ].join('\n');

    await page.setInputFiles('input[type="file"]', {
      name: 'roster_import_test.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvContent),
    });

    await page.click('button:has-text("Process Import"), button:has-text("Upload")');

    // Verify 3 accepted, 1 rejected with row details
    await expect(page.locator('text=3 Accepted, text=3 students imported').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=1 Rejected, text=Unknown matric').first()).toBeVisible();
    await expect(page.locator('text=U9999/XX/9999')).toBeVisible();

    // 5. Create Scheduled Session (starts_at = now + 5 min)
    await page.click('button:has-text("Sessions"), [role="tab"]:has-text("Sessions")');
    await page.click('button:has-text("Create Session"), button:has-text("New Session")');

    const futureTime = new Date(Date.now() + 5 * 60 * 1000);
    const timeString = futureTime.toTimeString().slice(0, 5); // HH:MM
    await page.fill('input[name="title"], input[placeholder*="Topic" i]', 'Algorithmic Complexity & O(n)');
    await page.fill('input[name="duration_minutes"]', '45');
    await page.fill('input[name="starts_at_time"]', timeString);
    await page.click('button:has-text("Schedule Session"), button:has-text("Create")');

    // Assert status is 'Scheduled'
    const sessionRow = page.locator('text=Algorithmic Complexity & O(n)').first();
    await expect(sessionRow).toBeVisible();
    await expect(page.locator('text=Scheduled, [data-status="scheduled"]').first()).toBeVisible();

    // 6. Advance clock by 6 minutes and verify transition to 'Active Live'
    await page.clock.fastForward(6 * 60 * 1000);
    await page.reload();

    await expect(page.locator('text=Active, text=Live, [data-status="active"]').first()).toBeVisible({ timeout: 10000 });

    // 7. Open Projector / Display view and verify dynamic QR code
    await page.click('button:has-text("Present QR"), button:has-text("Projector View"), [aria-label="QR Code"]');
    const qrCanvas = page.locator('canvas, svg[data-qr="true"], img[alt*="QR" i]');
    await expect(qrCanvas.first()).toBeVisible();
  });
});
