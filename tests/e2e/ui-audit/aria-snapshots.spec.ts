/**
 * Spec 155 PR D: what a screen reader is given (roles, names, states, reading order) for five
 * complex widgets, pinned as files in `aria-snapshots/`. A change there is a change to what is
 * spoken: review the diff, then regenerate with `--update-snapshots` (see the fixture README).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Locator, type Page } from '@playwright/test';

const SNAPSHOTS = path.join(import.meta.dirname, 'aria-snapshots');

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  await page.clock.install({ time: new Date('2026-01-14T10:00:00') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== process.env.MINION_ARIA_URL) {
      failures.push(`external request: ${url.href}`);
      await route.abort();
    } else if (url.pathname.startsWith('/api/')) {
      // No backend: record search and saved table settings answer "nothing".
      await route.fulfill({ status: 404, json: {} });
    } else await route.continue();
  });
  page.on('pageerror', (error) => failures.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

const open = async (page: Page, widget: string) => {
  await page.goto(`/?w=${widget}`);
  await page.evaluate(() => document.fonts.ready);
  return page.locator('main');
};
// Playwright's own `--update-snapshots` writes numbers as patterns (`/\\d+:\\d+/`), which would
// pin neither a time nor a date. On update the exact tree is written here instead.
const pin = async (target: Locator, name: string) => {
  if (test.info().config.updateSnapshots !== 'none') {
    mkdirSync(SNAPSHOTS, { recursive: true });
    writeFileSync(path.join(SNAPSHOTS, `${name}.aria.yml`), `${await target.ariaSnapshot()}\n`);
  } else await expect(target).toMatchAriaSnapshot({ name: `${name}.aria.yml` });
};

test('data table: default and sorted by name', async ({ page }) => {
  const main = await open(page, 'datatable');
  await expect(main.getByRole('row')).not.toHaveCount(0);
  await pin(main, 'datatable-default');
  await main.getByRole('columnheader', { name: 'Name' }).getByRole('button').first().click();
  await expect(main.locator('[aria-sort]:not([aria-sort="none"])')).toHaveCount(1);
  await pin(main, 'datatable-sorted');
});

// TODO(handoff): this snapshot pins the week view AS IT IS: no grid, row or column roles, a flat
// run of day labels and buttons (meta proposals/2026-11-20-hub-accessibility-program.md, item 24).
test('booking calendar: default week', async ({ page }) => {
  const main = await open(page, 'calendar');
  await expect(main.getByText('Carla Mendoza').first()).toBeVisible();
  await pin(main, 'calendar-week');
});

test('board: default', async ({ page }) => {
  const main = await open(page, 'board');
  await expect(main.getByText('Website redesign')).toBeVisible();
  await pin(main, 'board-default');
});

test('picker: closed and open', async ({ page }) => {
  const main = await open(page, 'picker');
  await pin(page.locator('body'), 'picker-closed');
  await main.getByRole('button', { name: 'Open picker' }).click();
  await expect(page.getByText('Keratin treatment')).toBeVisible();
  await pin(page.locator('body'), 'picker-open');
});

test('command palette: open, and filtered by a query', async ({ page }) => {
  const main = await open(page, 'palette');
  await main.getByRole('button', { name: 'Open palette' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await pin(dialog, 'palette-open');
  await dialog.getByRole('combobox').fill('set');
  await expect(dialog.getByRole('option', { name: 'Open Settings' })).toBeVisible();
  await pin(dialog, 'palette-filtered');
});
