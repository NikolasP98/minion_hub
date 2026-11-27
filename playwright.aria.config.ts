import { defineConfig } from '@playwright/test';
const baseURL = process.env.MINION_ARIA_URL;
if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).protocol !== 'http:')
  throw new Error('Aria snapshot fixture requires an owned loopback HTTP server');
export default defineConfig({
  testDir: './tests/e2e/ui-audit',
  testMatch: 'aria-snapshots.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // A missing snapshot fails instead of being written; `--update-snapshots` is the only way in.
  updateSnapshots: 'none',
  expect: {
    toMatchAriaSnapshot: { pathTemplate: 'tests/e2e/ui-audit/aria-snapshots/{arg}{ext}' },
  },
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  outputDir: process.env.MINION_ARIA_RESULTS ?? '.test-artifacts/aria',
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.MINION_ARIA_REPORT ?? '.test-artifacts/aria.json' }],
  ],
});
