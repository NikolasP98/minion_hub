/**
 * Owner directive 2026-09-30: while a record page is in edit mode, the
 * PageHeader shows Save/Cancel in place of Back (Back hidden, never
 * disabled) — no duplicate Save/Cancel row survives in the body. Browser
 * back/forward remains the only force-cancel. Runs against the seeded QA
 * tenant like record-peek.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { matrixUuid } from '../../../scripts/qa/seed/ids';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run this spec.');

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('edit mode header actions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('editing a stock item swaps header Back for Save/Cancel, and Cancel restores Back', async ({
    page,
  }) => {
    await page.goto(`/stock/items/${matrixUuid('stock.item.low-stock')}`, {
      waitUntil: 'networkidle',
    });
    const header = page.locator('[data-page-header]').first();
    await expect(header.getByRole('button', { name: /^Back$/i })).toBeVisible();

    await header.getByRole('button', { name: /^Edit$/i }).click();

    await expect(header.getByRole('button', { name: /^Back$/i })).toHaveCount(0);
    await expect(header.getByRole('button', { name: /^Save$/i })).toBeVisible();
    await expect(header.getByRole('button', { name: /^Cancel$/i })).toBeVisible();
    // No duplicated Save/Cancel row left in the body.
    await expect(page.getByRole('button', { name: /^Save$/i })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Cancel$/i })).toHaveCount(1);

    await header.getByRole('button', { name: /^Cancel$/i }).click();

    await expect(header.getByRole('button', { name: /^Back$/i })).toBeVisible();
    await expect(header.getByRole('button', { name: /^Save$/i })).toHaveCount(0);
  });
});
