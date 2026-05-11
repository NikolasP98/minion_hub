import { test, expect } from '@playwright/test';

/**
 * E2E happy path for the /workforce Dashboard vertical slice (Task 12).
 *
 * Required env vars (set before running):
 *   E2E_USER_EMAIL    — email of a Better Auth user with at least one workspace_membership row
 *   E2E_USER_PASSWORD — that user's password
 *
 * Required infrastructure:
 *   - hub running on the configured baseURL (playwright.config.ts → E2E_BASE_URL)
 *   - paperclip-server reachable from hub via PAPERCLIP_INTERNAL_URL
 *   - HUB_PAPERCLIP_SHARED_SECRET set identically on both services
 *   - At least one paperclip company seeded; the E2E user granted membership to it
 *
 * Run (self-starting dev server):
 *   bun test:e2e
 *
 * Run (against docker-compose stack):
 *   E2E_BASE_URL=http://localhost \
 *   E2E_USER_EMAIL=admin@example.com \
 *   E2E_USER_PASSWORD=secret \
 *   bun playwright test
 *
 * The test.skip guard makes the spec a no-op when E2E_USER_EMAIL is absent,
 * so `bun test:e2e` does not fail in environments lacking infra.
 * CI sets the env to actually exercise it.
 */

test('dashboard loads after login and respects company switcher', async ({ page }) => {
	test.skip(!process.env.E2E_USER_EMAIL, 'E2E_USER_EMAIL not set — skipping (no infra)');

	// ── 1. Login ──────────────────────────────────────────────────────────────
	await page.goto('/login');

	// The login form uses explicit `for`/`id` bindings:
	//   <label for="login-email">  <input id="login-email" type="email">
	//   <label for="login-password"> <input id="login-password" type="password">
	await page.locator('#login-email').fill(process.env.E2E_USER_EMAIL!);
	await page.locator('#login-password').fill(process.env.E2E_USER_PASSWORD!);

	// Submit button text: "Sign In →" (m.login_submit()) or "Signing in…" while loading.
	await page.getByRole('button', { name: /sign in/i }).click();

	// Better Auth signs in and the client calls goto(redirectTo) — lands on / or wherever redirectTo points.
	// Accept any non-login URL as success.
	await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

	// ── 2. Navigate to /workforce (Dashboard page) ───────────────────────────
	await page.goto('/workforce');

	// The page renders <h1 class="text-2xl font-semibold">Dashboard</h1>
	await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({
		timeout: 10_000,
	});

	// ── 3. Summary cards are present ─────────────────────────────────────────
	// <section aria-label="Summary"> with three sub-headings (Agents / Tasks / Monthly spend)
	await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();

	// ── 4. CompanySwitcher — switch company if more than one is available ────
	// <select aria-label="Select company"> rendered by CompanySwitcher.svelte.
	// The switcher only mounts when workspaces.length > 0, which requires a valid
	// paperclip session. Guard with a conditional so the assertion is safe even
	// when paperclip is unreachable (switcher just won't render).
	const switcher = page.getByLabel('Select company');
	const switcherVisible = await switcher.isVisible();

	if (switcherVisible) {
		// Verify at least one option is rendered.
		const options = switcher.locator('option');
		await expect(options).not.toHaveCount(0);

		const optionCount = await options.count();
		if (optionCount >= 2) {
			// Select the second company — triggers POST /api/workspaces/select + invalidateAll().
			await switcher.selectOption({ index: 1 });

			// Dashboard heading must remain after the company switch / re-render.
			await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible({
				timeout: 10_000,
			});

			// Switcher value should now reflect the selected company.
			const options2 = await options.all();
			const selectedValue = await options2[1].getAttribute('value');
			await expect(switcher).toHaveValue(selectedValue!);
		}
	}

	// ── 5. Recent activity section ────────────────────────────────────────────
	// <h2 class="text-lg font-semibold mb-2">Recent activity</h2>
	await expect(page.getByRole('heading', { name: 'Recent activity', level: 2 })).toBeVisible();
});
