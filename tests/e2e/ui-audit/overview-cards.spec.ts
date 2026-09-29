/**
 * OverviewCard on the CRM contact / POS ticket / invoice record pages, and the
 * `/pos/catalog` formula-catalog fix — spec 2026-09-28-hub-table-open-modes-
 * bulk-bar-stock-detail Slice 2 Bundle F. Runs against the seeded QA tenant
 * like table-interactions / record-peek.
 */
import { test, expect, type Page } from '@playwright/test';
// Deterministic seed ids — pure `matrixUuid` derivation, no DB/env side
// effects at import time (same pattern the seed scripts use for fixtures).
// Navigating straight to the record sidesteps the DataTable's per-table
// open-mode config (page/modal/tray) entirely, which Bundle A/E own.
// Only `ids.ts` — importing the seed modules themselves drags the whole seed
// graph (and its script-only typing) into svelte-check.
import { matrixUuid } from '../../../scripts/qa/seed/ids';

const TICKET_SPLIT_TENDER = matrixUuid('pos.ticket.split-tender-with-change');
const CONTACT_DNI_VERIFIED = matrixUuid('crm.contact.dni-verified');

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run the overview-card specs.',
);

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('overview cards', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('contact Overview Configure hides a fact and it stays hidden after reload', async ({
    page,
  }) => {
    await page.goto(`/crm/${CONTACT_DNI_VERIFIED}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.card-h', { hasText: /Details/i }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByText('Configure', { exact: true }).first().click();
    const toggle = page.locator('.configure-list [role="switch"]').first();
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    const before = await toggle.getAttribute('aria-checked');
    // The preference write is debounced 1s (`preference-sync.svelte.ts`) —
    // wait for it to actually reach the server before reloading, or the
    // reload races the PUT and reads the pre-toggle value back.
    const prefSaved = page.waitForResponse(
      (r) =>
        r.url().includes('/api/me/preferences/recordOverview') && r.request().method() === 'PUT',
      { timeout: 5_000 },
    );
    await toggle.click();
    const after = before === 'true' ? 'false' : 'true';
    await expect(toggle).toHaveAttribute('aria-checked', after);
    await prefSaved;
    await page.keyboard.press('Escape');

    // Persisted per-user preference — survives a reload.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.card-h', { hasText: /Details/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByText('Configure', { exact: true }).first().click();
    const toggleAfterReload = page.locator('.configure-list [role="switch"]').first();
    await expect(toggleAfterReload).toHaveAttribute('aria-checked', after, { timeout: 10_000 });
  });

  test('ticket page shows an Overview card', async ({ page }) => {
    await page.goto(`/pos/tickets/${TICKET_SPLIT_TENDER}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.card-h', { hasText: /Details/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('/pos/catalog renders a table', async ({ page }) => {
    await page.goto('/pos/catalog', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
  });
});
