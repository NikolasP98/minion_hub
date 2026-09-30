/**
 * Owner directive 2026-09-30: drag/click multi-cell + matrix selection,
 * spreadsheet-compatible copy (Ctrl/Cmd+C, dotted "copied" outline), row
 * selection copy (all visible columns), and paste into editable cells. Runs
 * against the seeded QA tenant like table-cell-select-tags.spec.ts.
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

async function dragSelect(
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.describe('table drag-select + copy/paste', () => {
  test.use({
    permissions: ['clipboard-read', 'clipboard-write'],
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
  });

  test('drag-select a 2×2 range, Ctrl+C copies TSV, and the copied outline shows', async ({
    page,
  }) => {
    // 'itemGroup'/'uom' — visible without horizontal scroll (unlike the
    // reorder columns, which sit off-screen on the seeded QA viewport and
    // made the raw mouse coordinates land on unrelated on-page text).
    const a = page.locator('tbody tr[data-row-index="0"] td[data-col="itemGroup"]').first();
    const b = page.locator('tbody tr[data-row-index="1"] td[data-col="uom"]').first();
    test.skip((await a.count()) === 0 || (await b.count()) === 0, 'Not enough seeded items.');

    await dragSelect(page, a, b);
    await expect(a).toHaveClass(/dt-sel/);
    await expect(b).toHaveClass(/dt-sel-focus/);
    await page.screenshot({ path: 'test-results/table-copy-drag-range.png' });

    await page.keyboard.press('Control+C');
    await expect(a).toHaveClass(/dt-copy-t/);
    await expect(a).toHaveClass(/dt-copy-l/);
    await expect(b).toHaveClass(/dt-copy-b/);
    await expect(b).toHaveClass(/dt-copy-r/);
    await page.screenshot({ path: 'test-results/table-copy-dotted-outline.png' });

    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.split('\t')).toHaveLength(2);
  });

  test('row-selection copy carries every visible column for the selected rows', async ({
    page,
  }) => {
    const row0 = page.locator('tbody tr[data-row-index="0"]');
    const row1 = page.locator('tbody tr[data-row-index="1"]');
    test.skip((await row0.count()) === 0 || (await row1.count()) === 0, 'Not enough seeded items.');
    const visibleCols = await page.locator('thead th[data-col]').count();

    await row0.locator('.dt-check.is-row').click();
    await row1.locator('.dt-check.is-row').click();
    await page.keyboard.press('Control+C');
    await page.screenshot({ path: 'test-results/table-copy-row-selection-outline.png' });

    const text = await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.split('\t')).toHaveLength(visibleCols);
  });

  test('paste into a plain textarea keeps the tab-separated structure', async ({ page }) => {
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = 'paste-sink';
      document.body.appendChild(ta);
    });
    const a = page.locator('tbody tr[data-row-index="0"] td[data-col="itemGroup"]').first();
    const b = page.locator('tbody tr[data-row-index="1"] td[data-col="uom"]').first();
    test.skip((await a.count()) === 0 || (await b.count()) === 0, 'Not enough seeded items.');
    await dragSelect(page, a, b);
    await page.keyboard.press('Control+C');

    await page.locator('#paste-sink').focus();
    await page.keyboard.press('Control+V');
    const value = await page.locator('#paste-sink').inputValue();
    const lines = value.split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.split('\t')).toHaveLength(2);
  });
});
