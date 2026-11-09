import { test, expect } from '@playwright/test';

/**
 * Test 05 - Device Binding Lifecycle & Administrative Override
 * Covers: SEC-15, QA-05, PERF-04, PERF-05
 * - Full lifecycle: Bind A -> Admin Reset A -> Rebind A
 * - Device handoff: Student B blocked on D1 -> Admin Reset -> B binds on D1 -> A blocked on D1
 * - Cross-role API verification between Student PWA and Admin Portal
 */
test.describe('05 - Device Binding Lifecycle Management', () => {
  const sessionToken = process.env.TEST_ACTIVE_SESSION_TOKEN || 'adun-live-session-csc201';

  test('comprehensive binding, admin reset, re-binding, and device ownership transfer', async ({ browser }) => {
    // Context D1 represents physical hardware device 1
    const deviceContextD1 = await browser.newContext();
    const studentPage = await deviceContextD1.newPage();

    // Context Admin represents Lecturer / Admin workstation
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // --- STEP 1: Student A binds to Device D1 ---
    await studentPage.goto(`/join/${sessionToken}`);
    await studentPage.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await studentPage.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await studentPage.waitForURL('**/attend/location', { timeout: 10000 });

    // --- STEP 2: Admin resets Student A's binding ---
    await adminPage.goto('/login');
    await adminPage.fill('input[name="email"]', 'lecturer@adun.edu.ng');
    await adminPage.fill('input[name="password"]', 'Lecturer123!');
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL('**/lecturer/dashboard', { timeout: 15000 });

    await adminPage.goto('/lecturer/device-bindings');
    const studentRow = adminPage.locator('tr:has-text("U2024/CS/1001"), [data-student="U2024/CS/1001"]');
    await expect(studentRow.first()).toBeVisible({ timeout: 10000 });
    await studentRow.locator('button:has-text("Reset"), button:has-text("Unbind")').first().click();

    // Confirm dialog
    await adminPage.fill('input[name="reason"], textarea[name="reason"]', 'Approved device reset requested by student');
    await adminPage.click('button:has-text("Confirm Reset"), button:has-text("Proceed")');
    await expect(adminPage.locator('text=Binding Reset Successfully, text=Device Unbound').first()).toBeVisible();

    // --- STEP 3: Student A binds again on D1 (Should succeed with new BIND-200) ---
    await studentPage.goto(`/join/${sessionToken}`);
    await studentPage.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await studentPage.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await studentPage.waitForURL('**/attend/location', { timeout: 10000 });

    // --- STEP 4: Student B tries to use D1 (Should be rejected with BIND-202) ---
    await studentPage.goto(`/join/${sessionToken}`);
    await studentPage.fill('input[placeholder*="Matric" i]', 'U2024/CS/1002');
    await studentPage.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await studentPage.waitForURL('**/block/*', { timeout: 10000 });
    await expect(studentPage.locator('text=BIND-202').first()).toBeVisible();

    // --- STEP 5: Admin resets device for Student B transfer ---
    await adminPage.goto('/lecturer/device-bindings');
    const aRow = adminPage.locator('tr:has-text("U2024/CS/1001")').first();
    await aRow.locator('button:has-text("Reset")').click();
    await adminPage.fill('textarea[name="reason"]', 'Transfer device to Student B');
    await adminPage.click('button:has-text("Confirm Reset")');

    // --- STEP 6: Student B now binds to D1 successfully ---
    await studentPage.goto(`/join/${sessionToken}`);
    await studentPage.fill('input[placeholder*="Matric" i]', 'U2024/CS/1002');
    await studentPage.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await studentPage.waitForURL('**/attend/location', { timeout: 10000 });

    // --- STEP 7: Student A now tries on D1 -> Blocked with BIND-202 ---
    await studentPage.goto(`/join/${sessionToken}`);
    await studentPage.fill('input[placeholder*="Matric" i]', 'U2024/CS/1001');
    await studentPage.click('button:has-text("Continue"), button:has-text("Confirm Identity")');
    await studentPage.waitForURL('**/block/*', { timeout: 10000 });
    await expect(studentPage.locator('text=BIND-202').first()).toBeVisible();

    await deviceContextD1.close();
    await adminContext.close();
  });
});
