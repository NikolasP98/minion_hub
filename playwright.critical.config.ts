import { defineConfig } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.MINION_CRITICAL_URL;
const webkitExecutable = process.env.MINION_WEBKIT_EXECUTABLE;
if (baseURL !== 'http://127.0.0.1:18903') throw new Error('Exact owned fixture URL required');
if (!process.env.MINION_CRITICAL_OUT) throw new Error('Exact built artifact required');
const evidence = path.resolve(process.env.MINION_CRITICAL_EVIDENCE ?? '.test-artifacts/critical');
export default defineConfig({
  testDir: './tests/e2e/ui-audit',
  testMatch: 'critical-journeys.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium-fine',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    { name: 'chromium-coarse', use: { browserName: 'chromium', hasTouch: true } },
    {
      name: 'firefox-fine',
      use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'webkit-fine',
      use: {
        browserName: 'webkit',
        viewport: { width: 1280, height: 900 },
        launchOptions: webkitExecutable ? { executablePath: webkitExecutable } : undefined,
      },
    },
    {
      name: 'webkit-coarse',
      use: {
        browserName: 'webkit',
        hasTouch: true,
        launchOptions: webkitExecutable ? { executablePath: webkitExecutable } : undefined,
      },
    },
  ],
  webServer: undefined,
  outputDir: path.join(evidence, 'results'),
  reporter: [
    ['list'],
    [
      './tests/e2e/ui-audit/critical-artifact.ts',
      { output: path.join(evidence, 'critical-results.json') },
    ],
  ],
});
