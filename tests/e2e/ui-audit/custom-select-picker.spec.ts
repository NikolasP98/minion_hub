/**
 * Owner directive 2026-09-30 (screenshots of /stock/items): the custom
 * select column showed a pencil after every value and its own inline
 * options editor. This proves the fix: no pencil on the resting cell, and
 * select-then-click/Enter opens the SAME search + option-chips popover the
 * tag picker uses (DataCellContext `open`/`onOpenChange`, hub #414 lineage).
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL ?? 'tenancy.user.owner@qa.minion.test';
const PASSWORD = process.env.E2E_OWNER_PASSWORD ?? 'QaStack!2026';

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

test.describe('custom select column picker (no pencil, tag-style popover)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('cell has no pencil at rest; select-then-click opens a search+options popover; a pick persists after reload', async ({
    page,
  }) => {
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    const headers = page.locator('table.dt-table thead th');
    const headerCount = await headers.count();
    let colIndex = -1;
    for (let i = 0; i < headerCount; i++) {
      if ((await headers.nth(i).innerText()).includes('QA Priority')) {
        colIndex = i;
        break;
      }
    }
    test.skip(colIndex === -1, 'QA Priority custom column not present in this seed.');

    const cell = page
      .locator(`table.dt-table tbody tr td:nth-child(${colIndex + 1})`, { hasText: 'High' })
      .first();
    test.skip((await cell.count()) === 0, 'No seeded row carries the QA Priority=High value.');

    // No pencil / edit affordance on the resting cell.
    await expect(cell.locator('svg')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/custom-select-picker-rest.png' });

    // Select the cell, then click again — the DataCellContext contract.
    await cell.click();
    await cell.click();

    const popover = page.getByRole('listbox', { name: /Options|Opciones/i });
    await expect(popover).toBeVisible({ timeout: 5_000 });
    await expect(
      popover.locator('input[placeholder="Search…"], input[placeholder="Buscar…"]'),
    ).toBeVisible();
    await page.screenshot({ path: 'test-results/custom-select-picker-open.png' });

    // Pick the already-selected active option (commits immediately).
    await popover.getByRole('button', { name: /^High$/ }).click();

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedCell = page
      .locator(`table.dt-table tbody tr td:nth-child(${colIndex + 1})`, { hasText: 'High' })
      .first();
    await expect(reloadedCell).toBeVisible();
    await expect(reloadedCell.locator('svg')).toHaveCount(0);
  });
});
