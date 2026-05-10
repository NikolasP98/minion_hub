import { defineConfig } from '@playwright/test';

// Hub dev server runs on port 5173 by default (Vite).
// Override with E2E_BASE_URL for docker-compose or production preview scenarios.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

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
	webServer: {
		command: 'vite dev',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe',
	},
	outputDir: './test-results',
	reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
});
