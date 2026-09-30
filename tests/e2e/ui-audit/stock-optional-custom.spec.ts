/**
 * Group / Reorder qty / MOQ moved from core stock.items fields to custom
 * columns — proposal 2026-09-30-hub-stock-item-optional-fields-to-custom-columns.md.
 * Runs against the QA tenant AFTER scripts/stock-optional-fields-to-custom.ts
 * --apply has populated the custom columns for ORG_BUSINESS.
 */
import { test, expect, type Page } from '@playwright/test';

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

test.describe('stock item optional fields → custom columns', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('/stock/items shows Group, Reorder qty, MOQ as columns with the backfilled values', async ({
    page,
  }) => {
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByRole('columnheader', { name: 'Group', exact: true })).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Reorder qty', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'MOQ', exact: true })).toBeVisible();

    const row = page.locator('tbody tr.dt-row', { hasText: 'QA-LOW' });
    test.skip((await row.count()) === 0, 'QA-LOW item not seeded.');
    await expect(row.first()).toContainText('Retail');
    await expect(row.first()).toContainText('20');
    await expect(row.first()).toContainText('5');
  });

  test('/settings/tables no longer lists itemGroup/reorderQty/moq as core fields for stock.items', async ({
    page,
  }) => {
    await page.goto('/settings/tables', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    const row = page.locator('tbody tr.dt-row', { hasText: 'Items' });
    test.skip((await row.count()) === 0, 'stock.items row not found in settings/tables.');
    await row.first().locator('.dt-exp').click({ force: true });

    const fieldsPane = page.locator('.fields-pane').first();
    await expect(fieldsPane).toBeVisible({ timeout: 10_000 });
    const fieldKeys = fieldsPane.locator('.dt-mono');
    const keys = (await fieldKeys.allTextContents()).map((k) => k.trim());
    expect(keys).not.toContain('itemGroup');
    expect(keys).not.toContain('reorderQty');
    expect(keys).not.toContain('moq');
    // reorderLevel stays core — it gates the low-stock alert.
    expect(keys).toContain('reorderLevel');
  });
});
