/**
 * Table toolbar + Notion-style filters (spec
 * 2026-09-29-hub-table-toolbar-notion-filters) on /pos/catalog: the "Show
 * inactive" toggle is gone — inactive visibility is now the default `Active`
 * filter chip — plus the "+ Filter" menu, an operator-aware chip, and the
 * group-by picker (labelled "Type" for the `category` axis). Runs against
 * the seeded QA tenant like record-peek.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run the filter specs.');

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

const INACTIVE_SELLABLE_NAME = 'QA Inactive Sellable';

test.describe('catalog table toolbar filters', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/pos/catalog', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
  });

  test('the default Active chip hides the seeded inactive sellable; removing it reveals it', async ({
    page,
  }) => {
    const activeChip = page.locator('.fchip', { hasText: 'Active' });
    await expect(activeChip).toBeVisible();
    await expect(page.getByText(INACTIVE_SELLABLE_NAME)).toHaveCount(0);

    await activeChip.hover();
    await activeChip.locator('.fchip-x').click();
    await expect(page.getByText(INACTIVE_SELLABLE_NAME)).toBeVisible({ timeout: 15_000 });
  });

  test('Filter icon → Stock → > narrows the visible rows', async ({ page }) => {
    const famTrigger = page.locator('.dt-toolbar [aria-label="Filter"]');
    await famTrigger.click();
    const stockRow = page.locator('.fam-row', { hasText: /^Stock$/ });
    test.skip((await stockRow.count()) === 0, 'Stock module disabled for this tenant.');

    const before = await page.locator('tbody tr[data-row-index]').count();
    expect(before).toBeGreaterThan(0);

    await stockRow.click();
    // Picking a property opens its chip's popover immediately.
    const panel = page.locator('.fchip-panel:visible');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await panel.locator('select[aria-label="Operator"]').selectOption({ label: '>' });
    await panel.locator('input[aria-label="Value"]').fill('999999');

    // No seeded item plausibly stocks a million units — the table narrows to
    // (or towards) zero rows, proving the operator+operand actually filters.
    await expect
      .poll(async () => page.locator('tbody tr[data-row-index]').count(), { timeout: 15_000 })
      .toBeLessThan(before);
  });

  test('group picker: picking "Type" shows group headers; the pill\'s × clears them', async ({
    page,
  }) => {
    const picker = page.locator('.gbp-btn').first();
    await picker.click();
    await page.getByRole('menuitem', { name: /^Type$/ }).click();

    await expect(page.locator('tbody tr.dt-group-row').first()).toBeVisible({ timeout: 10_000 });

    const pillWrap = page.locator('.gbp', { has: page.locator('.gbp-pill') });
    await pillWrap.locator('.gbp-pill').hover();
    await pillWrap.locator('.gbp-clear').click();

    await expect(page.locator('tbody tr.dt-group-row')).toHaveCount(0, { timeout: 10_000 });
  });

  test('the board view honours the Active filter — the inactive sellable stays hidden', async ({
    page,
  }) => {
    await expect(page.locator('.fchip', { hasText: 'Active' })).toBeVisible();
    await page.getByRole('button', { name: /^Board$/ }).click();
    await expect(page.locator('.board').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.bcard', { hasText: INACTIVE_SELLABLE_NAME })).toHaveCount(0);
  });
});
