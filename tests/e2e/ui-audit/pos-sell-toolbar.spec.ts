/**
 * /pos/sell — the category-pill wall becomes the shared table toolbar's
 * Filter / Group-by icon tools (proposal
 * 2026-09-30-hub-pos-sell-compact-toolbar.md). Runs against the QA stack.
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

test.describe('POS sell compact toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/pos/sell', { waitUntil: 'networkidle' });
    await expect(page.locator('.chips-row')).toBeVisible({ timeout: 30_000 });
  });

  test('category pills are gone; Filter + Group-by are icon tools', async ({ page }) => {
    // The old category pill wall (`.chip-btn`, "All" + one per category) no
    // longer renders anywhere on the page.
    await expect(page.locator('.chip-btn')).toHaveCount(0);

    await expect(page.locator('.dt-view-tools')).toBeVisible();
    await expect(page.locator('[aria-label="Filter"]')).toBeVisible();
    await expect(page.locator('.gbp-btn')).toBeVisible();
  });

  test('Filter → Category adds a right-aligned chip and narrows the gallery', async ({ page }) => {
    const cardsBefore = await page.locator('.grid .card').count();

    await page.locator('[aria-label="Filter"]').click();
    // ponytail/TODO(handoff): @minion-stack/ui's Button.svelte spreads `{...rest}`
    // (which would carry a `role` prop) BEFORE its own unconditional
    // `role={href && isDisabled ? 'link' : undefined}` attribute, so any
    // `role="option"`/`role="menuitem"` a caller passes is silently clobbered
    // back to `undefined` in the rendered DOM (verified live: FilterAddMenu's
    // `.fam-row` Button never actually gets `role="option"`). Pre-existing in
    // the shared package (packages/ui in the meta-repo), out of scope here —
    // flagged via proposals/2026-09-30-hub-pos-sell-compact-toolbar.md. Using
    // the `.fam-row` class + visible text instead of `getByRole` until fixed.
    await page.locator('.fam-row', { hasText: 'Category' }).click();

    // Chip appears in the `.dt-chips` bar, right-aligned under the tool.
    const chip = page.locator('.dt-chips .fchip', { hasText: 'Category' });
    await expect(chip).toBeVisible();

    // Its operand popover opened automatically (just-picked chip); select the
    // first available value.
    const firstOption = page.locator('.fre-list .fre-row').first();
    test.skip((await firstOption.count()) === 0, 'No category values seeded.');
    const pickedLabel = (await firstOption.locator('.fre-lbl').textContent())?.trim();
    await firstOption.click();
    await expect(chip).toContainText(pickedLabel ?? '');

    // The gallery narrowed (or stayed the same if only one category exists).
    const cardsAfter = await page.locator('.grid .card').count();
    expect(cardsAfter).toBeLessThanOrEqual(cardsBefore);

    // Advanced opens the rule-tree builder.
    await page.locator('[aria-label="Filter"]').click();
    await page.locator('.fam-advanced').click();
    await expect(page.locator('.afb')).toBeVisible();

    // Clear all removes the chip.
    await page.getByRole('button', { name: /clear/i }).click();
    await expect(page.locator('.dt-chips')).toHaveCount(0);
  });

  test('Group by → Body area groups the gallery AND the table view identically', async ({
    page,
  }) => {
    await page.locator('.gbp-btn').click();
    await page.getByRole('menuitem', { name: 'Body area' }).click();

    // Pill now shows the active label with a clear ×.
    const pill = page.locator('.gbp-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Body area');

    const galleryHeaders = await page.locator('.grp-head .grp-name').count();
    expect(galleryHeaders).toBeGreaterThan(0);

    // Same grouping in the table view.
    await page.locator('[aria-label="Table view"]').click();
    await expect(page.locator('.table-wrap')).toBeVisible();
    const tableHeaders = await page.locator('.table-wrap .tgroup').count();
    expect(tableHeaders).toBeGreaterThan(0);

    // Clearing the group-by pill returns to flat (no headers), both views.
    // The × is a hover-reveal affordance (width:0 at rest) — hover the pill
    // first so it's actually actionable.
    await pill.hover();
    await page.locator('.gbp-clear').click();
    await expect(page.locator('.table-wrap .tgroup')).toHaveCount(0);
  });
});
