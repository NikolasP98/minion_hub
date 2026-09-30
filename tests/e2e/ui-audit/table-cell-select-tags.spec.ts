/**
 * Owner directive 2026-09-29: "every cell is selectable, but not all are
 * editable" + the tags column should select-then-click instead of an
 * always-visible "+ Add tag" trigger. Runs against the seeded QA tenant like
 * record-peek.spec.ts.
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

test.describe('table cell selection + tag cell picker', () => {
  test.use({ deviceScaleFactor: 2 });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
  });

  test('a read-only cell shows the selection ring but never opens an editor', async ({ page }) => {
    const qtyCell = page.locator('tbody tr[data-row-index="0"] td[data-col="qtyOnHand"]').first();
    test.skip((await qtyCell.count()) === 0, 'No seeded items.');
    await expect(qtyCell).toHaveAttribute('data-editable', 'false');

    await qtyCell.click();
    await expect(qtyCell).toHaveClass(/dt-sel-focus/);
    await page.screenshot({ path: 'test-results/table-cell-select-readonly-selected.png' });

    // Enter (the "open it" gesture) is inert on a read-only cell.
    await page.keyboard.press('Enter');
    await expect(qtyCell.locator('input')).toHaveCount(0);
  });

  test('a tag cell selects on the first click, opens the picker on the second, and the chip has no ×', async ({
    page,
  }) => {
    const tagCell = page.locator('tbody tr[data-row-index="0"] td[data-col="tags"]').first();
    test.skip((await tagCell.count()) === 0, 'No seeded items.');

    // Table mode never shows the "+ Add tag" trigger.
    await expect(tagCell.getByText(/add tag/i)).toHaveCount(0);

    await tagCell.click();
    await expect(tagCell).toHaveClass(/dt-sel-focus/);
    await page.screenshot({ path: 'test-results/table-cell-select-tag-selected.png' });

    await tagCell.click();
    const popover = page.locator('[data-scope="popover"][data-part="content"]:not([hidden])');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/table-cell-select-tag-popover-open.png' });

    // Pick the first available tag option, then close the popover.
    const option = popover.locator('[role="option"], button').first();
    if ((await option.count()) > 0) {
      await option.click();
      await page.keyboard.press('Escape');
    } else {
      await page.keyboard.press('Escape');
    }

    const chip = tagCell.locator('.tag-chip').first();
    if ((await chip.count()) > 0) {
      // No × in table view.
      await expect(chip.locator('.chip-x')).toHaveCount(0);

      const labelBoxRest = await chip.locator('.tag-chip-name').boundingBox();
      await page.screenshot({ path: 'test-results/table-cell-select-tag-chip-rest.png' });
      await chip.hover();
      const labelBoxHover = await chip.locator('.tag-chip-name').boundingBox();
      await page.screenshot({ path: 'test-results/table-cell-select-tag-chip-hover.png' });

      // The label never moves between rest and hover (owner: "the text
      // alignment in the pill itself is off... when I hover... the remove
      // button is covering the content").
      expect(labelBoxRest?.x).toBeCloseTo(labelBoxHover?.x ?? -1, 0);
      expect(labelBoxRest?.y).toBeCloseTo(labelBoxHover?.y ?? -1, 0);
    }
  });
});
