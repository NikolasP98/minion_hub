/**
 * Bulk bar "Tags" action + per-user ("For me") open-mode preference — spec
 * 2026-09-28-hub-table-open-modes-bulk-bar-stock-detail slice 2 Bundle E.
 * Runs against the seeded QA tenant like record-peek.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD to run the bulk-tags specs.',
);

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

async function setOpenMode(page: Page, tableId: string, openIn: 'page' | 'modal' | 'tray') {
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

test.describe('bulk bar — Tags', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('bulk-adding a new tag on two selected items shows it on both rows', async ({ page }) => {
    await page.goto('/stock/items', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });
    const checks = page.locator('.dt-check.is-row');
    test.skip((await checks.count()) < 2, 'Need two seeded items.');
    // The floating bulk bar pins to the bottom of the table pane once a row
    // is selected and can visually overlap a nearby row — force both clicks
    // (same reasoning as record-peek.spec.ts's title clicks).
    await checks.nth(0).click({ force: true });
    await checks.nth(1).click({ force: true });

    const bar = page.locator('.dt-bulk-bar');
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: /^tags/i }).click();

    const tagName = `qa-bulk-${Date.now()}`;
    // Every row's own inline "+" tag popover mounts the same `TagOptionList`
    // (Zag keeps closed popover content in the DOM, just `hidden`) — scope to
    // the one that's actually visible (the bulk popover we just opened).
    const search = page.locator('input.search:visible');
    await search.first().fill(tagName);
    await page.getByRole('button', { name: new RegExp(`create.*${tagName}`, 'i') }).click();

    await page.getByRole('button', { name: /^apply$/i }).click();
    // Match the APPLIED tag chip specifically (`TagsField` renders it with an
    // `onremove`, giving it the `removable` class) — plain text or even a
    // visibility filter also catches this tag's OPTION row inside every other
    // row's own "+" popover, and inside the bulk popover itself (still open).
    await expect(
      page.locator('.tag-chip.removable .tag-chip-name', { hasText: tagName }),
    ).toHaveCount(2, { timeout: 15_000 });
  });
});

test.describe('per-user table open-mode preference', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test.afterEach(async ({ page }) => {
    await setOpenMode(page, 'pos.catalog', 'page');
  });

  test('"For me" opens a modal without changing the org config', async ({ page }) => {
    await page.goto('/pos/catalog', { waitUntil: 'networkidle' });
    await expect(page.locator('table.dt-table').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    // Scope defaults to "For me" — leave it there and switch the mode.
    await expect(page.getByRole('button', { name: /for me/i })).toBeVisible();
    await page.getByRole('button', { name: /^modal$/i }).click();
    // The column menu has no Escape handler — it closes via its own
    // full-viewport backdrop button, which a `force` click on the title would
    // otherwise hit first (force skips Playwright's checks, not the browser's
    // real hit-test at those coordinates).
    await page.locator('.backdrop').click();

    const title = page.locator('a.dt-open').first();
    test.skip((await title.count()) === 0, 'No seeded catalog rows.');
    await title.click({ force: true });
    await expect(page.locator('dialog[open][data-presentation="dialog"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('Escape');

    // The org's table config is untouched — the "for me" write only reached
    // `preferences.tableOpenIn`, never `PUT /api/tables/config`.
    const orgConfig = await page.evaluate(
      async () =>
        (await (await fetch('/api/tables/config')).json()) as Record<string, { openIn?: string }>,
    );
    expect(orgConfig['pos.catalog']?.openIn).toBeUndefined();
  });
});
