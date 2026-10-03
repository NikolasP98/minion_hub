import path from 'node:path';
import { defineConfig } from '@playwright/test';

if (process.env.MINION_DEPENDENCY_URL !== 'http://127.0.0.1:18904') {
  throw new Error('Exact owned dependency fixture URL required');
}
if (!process.env.MINION_DEPENDENCY_OUT || !path.isAbsolute(process.env.MINION_DEPENDENCY_OUT)) {
  throw new Error('Absolute dependency fixture artifact required');
}
if (
  !process.env.MINION_DEPENDENCY_EVIDENCE ||
  !path.isAbsolute(process.env.MINION_DEPENDENCY_EVIDENCE)
) {
  throw new Error('Absolute dependency evidence path required');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'dependency-security.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  use: {
    baseURL: process.env.MINION_DEPENDENCY_URL,
    headless: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: undefined,
  outputDir: path.join(process.env.MINION_DEPENDENCY_EVIDENCE, 'results'),
  reporter: [
    ['list'],
    [
      './tests/e2e/dependency-security-artifact.ts',
      { output: path.join(process.env.MINION_DEPENDENCY_EVIDENCE, 'dependency-results.json') },
    ],
  ],
});
