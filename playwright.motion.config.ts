import { defineConfig } from '@playwright/test';
const baseURL = process.env.MINION_MOTION_URL;
if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1' || new URL(baseURL).protocol !== 'http:')
  throw new Error('Workshop fixture requires an owned loopback HTTP server');
export default defineConfig({
  testDir: './tests/e2e/ui-audit',
  testMatch: 'workshop-motion.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: process.env.MINION_WEBKIT_EXECUTABLE
          ? { executablePath: process.env.MINION_WEBKIT_EXECUTABLE }
          : undefined,
      },
    },
  ],
  outputDir: process.env.MINION_MOTION_RESULTS ?? '.test-artifacts/motion',
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.MINION_MOTION_REPORT ?? '.test-artifacts/motion.json' }],
  ],
});
