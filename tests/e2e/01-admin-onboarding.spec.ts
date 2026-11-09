import { test, expect } from '@playwright/test';

/**
 * Test 01 - Admin Onboarding & Access Control
 * Covers: SEC-16, QA-03, QA-21
 * - Login as default admin
 * - Forced password change verification
 * - Logout and login with updated credential
 * - Lecturer provisioning
 * - Course creation and assignment
 */
test.describe('01 - Admin Onboarding Workflow', () => {
  test('admin forced password change, re-auth, and academic provisioning', async ({ page }) => {
    // 1. Navigate to Admin Portal Login
    await page.goto('/login');
    await expect(page).toHaveTitle(/ADUN Attendance/);

    // 2. Initial Admin Login
    await page.fill('input[type="email"], input[name="email"]', 'admin@adun.edu.ng');
    await page.fill('input[type="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // 3. Forced Password Change Modal must be displayed
    const modalHeading = page.locator('text=Password Change Required, text=Change Default Password, text=Update Password');
    await expect(modalHeading.first()).toBeVisible({ timeout: 10000 });

    const newPassword = 'SecureAdmin2026!#';
    await page.fill('input[name="newPassword"], input[placeholder*="new password" i]', newPassword);
    await page.fill('input[name="confirmPassword"], input[placeholder*="confirm" i]', newPassword);
    await page.click('button:has-text("Update Password"), button:has-text("Save")');

    // 4. Confirm redirection to Admin Dashboard
    await page.waitForURL('**/admin/home', { timeout: 15000 });
    await expect(page.locator('text=System Administration, text=Dashboard, text=Admin Overview').first()).toBeVisible();

    // 5. Logout and verify session termination
    await page.click('button:has-text("Sign Out"), button:has-text("Logout"), [aria-label="Logout"]');
    await page.waitForURL('**/login', { timeout: 10000 });

    // 6. Login with new password
    await page.fill('input[type="email"], input[name="email"]', 'admin@adun.edu.ng');
    await page.fill('input[type="password"]', newPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin/home', { timeout: 10000 });

    // 7. Provision a new Lecturer
    await page.goto('/admin/lecturers');
    await page.click('button:has-text("Add Lecturer"), button:has-text("New Lecturer")');
    const lecturerEmail = `dr.okoro_${Date.now()}@adun.edu.ng`;
    await page.fill('input[name="full_name"]', 'Dr. Emeka Okoro');
    await page.fill('input[name="email"]', lecturerEmail);
    await page.fill('input[name="department"]', 'Computer Science');
    await page.click('button:has-text("Create Lecturer"), button:has-text("Save")');
    await expect(page.locator(`text=${lecturerEmail}`)).toBeVisible();

    // 8. Provision Course assigned to lecturer
    await page.goto('/admin/courses');
    await page.click('button:has-text("Create Course"), button:has-text("New Course")');
    const courseCode = `CSC201_${Date.now().toString().slice(-4)}`;
    await page.fill('input[name="course_code"]', courseCode);
    await page.fill('input[name="title"]', 'Computer Programming II');
    await page.selectOption('select[name="lecturer_id"]', { label: 'Dr. Emeka Okoro' });
    await page.click('button:has-text("Save Course"), button:has-text("Create")');
    await expect(page.locator(`text=${courseCode}`)).toBeVisible();
  });
});
