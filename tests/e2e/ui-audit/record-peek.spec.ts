/**
 * Record open modes (page / modal / tray), the floating bulk bar and the
 * stock detail restructure — spec 2026-09-28-hub-table-open-modes-bulk-bar-
 * stock-detail. Runs against the seeded QA tenant like table-interactions.
 */
import { test, expect, type Page } from '@playwright/test';
import { matrixUuid } from '../../../scripts/qa/seed/ids';

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

async function setOpenMode(page: Page, tableId: string, openIn: 'page' | 'modal' | 'tray') {
  // In-page fetch: same origin + cookies as the app itself (page.request lacks the origin header).
  const status = await page.evaluate(
    async ([id, mode]) =>
      (
        await fetch('/api/tables/config', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [id]: { openIn: mode } }),
        })
      ).status,
    [tableId, openIn] as const,
  );
  expect(status).toBe(200);
}

test.describe('record open modes', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test.afterEach(async ({ page }) => {
    await setOpenMode(page, 'stock.items', 'page');
    await setOpenMode(page, 'stock.entries', 'page');
  });

  test('settings/tables shows the open-mode column and a title opens a modal peek', async ({
    page,
  }) => {
    await page.goto('/settings/tables', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('th', { hasText: /Open records in/i })).toBeVisible();

    await setOpenMode(page, 'stock.items', 'modal');
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
    const title = page.locator('a.dt-open').first();
    test.skip((await title.count()) === 0, 'No seeded items.');
    const href = await title.getAttribute('href');
    await title.click({ force: true });
    const dialog = page.locator('dialog[open][data-presentation="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // The list stays mounted underneath (shallow routing keeps the URL).
    expect(new URL(page.url()).pathname).toMatch(/\/stock\/items$/);
    await expect(dialog.locator('.card-h', { hasText: /Overview/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    // Expand → full page, replacing the peek entry.
    await dialog.getByRole('button', { name: /open full page/i }).click();
    await page.waitForURL((u) => u.pathname.endsWith(href!.replace(/^\/(en|es)/, '')), {
      timeout: 15_000,
    });
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('entries open in a tray; Escape closes it and keeps the list', async ({ page }) => {
    await setOpenMode(page, 'stock.entries', 'tray');
    await page.goto('/stock/entries', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('th', { hasText: /Document/i })).toBeVisible();
    const title = page.locator('a.dt-open').first();
    test.skip((await title.count()) === 0, 'No seeded entries.');
    await title.click({ force: true });
    const sheet = page.locator('dialog[open][data-presentation="sheet"]');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('table.dt-table').first()).toBeVisible();
    // Owner directive 2026-09-29: a plain row click no longer opens the
    // record (it used to fire out from under a picker cell mid-edit) — only
    // the `.dt-open` arrow (or the title link) does, and it honours the mode.
    await page.locator('tbody tr.dt-row').first().locator('a.dt-open').click({ force: true });
    await expect(page.locator('dialog[open][data-presentation="sheet"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 10_000 });
  });

  test('selecting rows shows the floating bulk bar with Edit property', async ({ page }) => {
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
    const checks = page.locator('.dt-check.is-row');
    test.skip((await checks.count()) < 2, 'Need two seeded rows.');
    await checks.nth(0).click();
    await checks.nth(1).click();
    const bar = page.locator('.dt-bulk-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2');
    await expect(bar.getByRole('button', { name: /edit property/i })).toBeVisible();
    await expect(bar.getByRole('button', { name: /archive/i })).toBeVisible();
  });

  test('item detail has Overview and Stock cards with a New entry dropdown', async ({ page }) => {
    // The seeded low-stock item has a bin, so the Stock table has a warehouse row.
    await page.goto(`/stock/items/${matrixUuid('stock.item.low-stock')}`, {
      waitUntil: 'networkidle',
    });
    await expect(page.locator('.card-h', { hasText: /Overview/i }).first()).toBeVisible();
    await expect(page.locator('.card-h', { hasText: /^\s*Stock\b/i }).first()).toBeVisible();
    await expect(page.locator('.card-h', { hasText: /Bins/i })).toHaveCount(0);
    // The action lives per warehouse row (last column of the Stock table).
    await page
      .locator('.dt-row-actions')
      .getByRole('button', { name: /new entry/i })
      .first()
      .click();
    await expect(page.getByRole('menuitem', { name: /receipt/i })).toBeVisible();
  });
});
