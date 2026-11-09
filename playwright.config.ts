import { defineConfig, devices } from '@playwright/test';

/**
 * ADUN Attendance System - Playwright E2E Configuration
 * Tests Student PWA and Admin Portal with origin separation, camera/geo permissions,
 * and cross-browser coverage.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    bypassCSP: false,
  },
  projects: [
    // -------------------------------------------------------------------------
    // Student PWA - Desktop & Mobile Browsers
    // -------------------------------------------------------------------------
    {
      name: 'student-pwa-chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.STUDENT_PWA_URL || 'http://localhost:5173',
        permissions: ['geolocation', 'camera'],
        geolocation: { latitude: 6.3350, longitude: 5.6037 }, // ADUN Campus
      },
      testMatch: /03-.*|04-.*|05-.*|06-.*|07-.*/,
    },
    {
      name: 'student-pwa-mobile-safari',
      use: {
        ...devices['iPhone 14'],
        baseURL: process.env.STUDENT_PWA_URL || 'http://localhost:5173',
        permissions: ['geolocation', 'camera'],
        geolocation: { latitude: 6.3350, longitude: 5.6037 },
      },
      testMatch: /03-.*|04-.*|05-.*|08-.*/,
    },
    {
      name: 'student-pwa-firefox',
      use: {
        ...devices['Desktop Firefox'],
        baseURL: process.env.STUDENT_PWA_URL || 'http://localhost:5173',
        permissions: ['geolocation', 'camera'],
        geolocation: { latitude: 6.3350, longitude: 5.6037 },
      },
      testMatch: /08-.*/,
    },

    // -------------------------------------------------------------------------
    // Admin & Lecturer Portal
    // -------------------------------------------------------------------------
    {
      name: 'admin-portal-chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_PORTAL_URL || 'http://localhost:5174',
      },
      testMatch: /01-.*|02-.*|05-.*/,
    },
  ],
  webServer: [
    {
      command: 'npm run dev --prefix student-pwa',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev --prefix admin-portal',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
