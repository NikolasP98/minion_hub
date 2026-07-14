import { defineConfig } from '@playwright/test';

// UI-audit worktrees use an isolated strict port so reuseExistingServer cannot
// silently certify a different checkout already running on 5173.
const AUDIT_ENABLED = process.env.E2E_UI_AUDIT === '1';
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
const BASE_URL =
  EXTERNAL_BASE_URL ?? (AUDIT_ENABLED ? 'http://127.0.0.1:5187' : 'http://localhost:5173');
const COARSE_POINTER = process.env.E2E_UI_AUDIT_POINTER === 'coarse';
const serverUrl = new URL(BASE_URL);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    hasTouch: COARSE_POINTER,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // Self-starts the hub dev server when running locally.
  // In CI / docker-compose: set E2E_BASE_URL to the running container and
  // comment out or skip webServer — Playwright skips it when reuseExistingServer
  // finds the URL already responding.
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        command: `vite dev --host ${serverUrl.hostname} --port ${serverUrl.port || '5173'} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !AUDIT_ENABLED && !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
});
