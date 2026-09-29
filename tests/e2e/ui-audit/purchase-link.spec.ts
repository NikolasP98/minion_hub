/**
 * Receipt ↔ purchase link (spec 2026-09-28-hub-table-open-modes-bulk-bar-
 * stock-detail, Slice 2 Bundle D). Runs against the seeded QA tenant like
 * record-peek.spec.ts. A receipt only shows a "Purchase" Document link once
 * someone has picked a provider invoice on it — the seed may not have one
 * yet, so the case skips rather than failing when none is found.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run the peek specs.');

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('receipt to purchase link', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a receipt with a purchase opens the purchase peek', async ({ page }) => {
    await page.goto('/stock/entries', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    const purchaseBadge = page.locator('.doc-cell', { hasText: 'Purchase' }).first();
    test.skip((await purchaseBadge.count()) === 0, 'No seeded receipt has a purchase linked yet.');

    await purchaseBadge.locator('.doc-link').click();
    const dialog = page.locator('dialog[open][data-presentation="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('.card-h', { hasText: /Details/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.locator('.card-h', { hasText: /Stock entries/i }).first()).toBeVisible();
  });

  test('the purchases list title link opens the purchase detail route', async ({ page }) => {
    await page.goto('/finances/purchases', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    const title = page.locator('a.dt-open').first();
    test.skip((await title.count()) === 0, 'No seeded purchases.');
    await title.click({ force: true });
    await page.waitForURL(/\/finances\/purchases\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.locator('.card-h', { hasText: /Details/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
