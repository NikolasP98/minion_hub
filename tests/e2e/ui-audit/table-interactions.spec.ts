/**
 * Tables — interaction e2e (spec 2026-09-28 §T3).
 *
 * The calendars have had two Playwright specs since 2026-09-27; the shared
 * `DataTable` had NONE, while 33 consumers depend on it. This covers the
 * behaviours T1/T3 moved into the shared component, against the real app on a
 * seeded disposable tenant (same login path as `route-audit.spec.ts` — no
 * production data, no stored cookies):
 *
 * - sort toggle (and its URL mirror through `data-table/kit`),
 * - column filter → removable chip → remove → clear all,
 * - URL round-trip on `/crm/customers` (`?q=`, `?sort=`, `?f.stage=`),
 * - a row-action click never opening the row (`rowActions` isolation),
 * - inline edit + Escape restoring the committed value,
 * - `groupBy` header collapse/expand on `/pos/catalog`.
 *
 * Every scenario SKIPS instead of failing when the seeded tenant has no rows
 * for that surface: an empty seed is a fixture problem, not a table regression.
 */
import { expect, test, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  'Set E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD (deterministic seeded owner) to run the table specs.',
);

/** Same deterministic login as the route audit: no stored state, no cookies. */
async function login(page: Page) {
  await page.context().clearCookies();
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(EMAIL!);
  await page.locator('#login-password').fill(PASSWORD!);
  await page.getByRole('button', { name: /sign in|iniciar/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\/|$)/, { timeout: 20_000 });
}

const rows = (page: Page) => page.locator('tr.dt-row');
const chips = (page: Page) => page.locator('.dt-chips .chip');

/** Hydration of a module grid takes a while on a cold dev server. */
async function openTable(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await expect(page.locator('table.dt-table')).toBeVisible({ timeout: 30_000 });
}

async function skipWhenEmpty(page: Page) {
  const count = await rows(page).count();
  test.skip(count === 0, 'Seeded tenant has no rows for this table.');
}

/** The first sortable header button (label text is locale-dependent). */
const sortHeader = (page: Page, nth = 0) => page.locator('th.dt-th button.sort-h').nth(nth);
/** The first column-filter trigger in the header. */
const filterHead = (page: Page, nth = 0) => page.locator('th.dt-th .cf > button').nth(nth);
/** The options of an OPEN column-filter popover. */
const options = (page: Page) => page.locator('.cf .pop button[aria-selected]');

function tableScenarios(width: number, height: number) {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width, height });
    await login(page);
  });

  test('sorting a column toggles direction and mirrors it in the URL', async ({ page }) => {
    await openTable(page, '/crm/customers');
    await skipWhenEmpty(page);
    const header = sortHeader(page);
    await header.click();
    await expect(page).toHaveURL(/[?&]sort=[^&]+%3A(asc|desc)|[?&]sort=[^&]+:(asc|desc)/, {
      timeout: 10_000,
    });
    const first = new URL(page.url()).searchParams.get('sort');
    await header.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('sort'), { timeout: 10_000 })
      .not.toBe(first);
    // Same column, opposite direction — a toggle, never a second sort key.
    expect(first?.split(':')[0]).toBe(new URL(page.url()).searchParams.get('sort')?.split(':')[0]);
  });

  test('a column filter raises a removable chip, and Clear all empties the bar', async ({
    page,
  }) => {
    await openTable(page, '/crm/customers');
    await skipWhenEmpty(page);
    await filterHead(page).click();
    // The first option is "All" (the clear row); the second is a real value.
    // `aria-selected`, not `role=option`: the shared `Button` does not forward a
    // `role` (an a11y gap of its own, ledgered — the table specs must not
    // pretend the attribute is there).
    await options(page).nth(1).click();
    await expect(chips(page)).toHaveCount(1);
    await expect(page).toHaveURL(/[?&]f\./, { timeout: 10_000 });

    // Remove through the chip's own × …
    await chips(page).first().locator('button').click();
    await expect(chips(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]f\./);

    // … and through Clear all.
    await filterHead(page).click();
    await options(page).nth(1).click();
    await expect(chips(page)).toHaveCount(1);
    await page.locator('.dt-chips .dt-chip-clear').click();
    await expect(page.locator('.dt-chips')).toHaveCount(0);
  });

  test('search, sort and a column filter round-trip through the URL', async ({ page }) => {
    await openTable(page, '/crm/customers?q=a&sort=name%3Aasc&f.stage=New');
    // The kit parses on init: the search box carries `q`, the chip bar carries
    // `f.stage`, and the sorted header is the one `sort` names.
    await expect(page.locator('.dt-search input')).toHaveValue('a');
    await expect(chips(page)).toHaveCount(1);
    await expect(page.locator('th.dt-th button.sort-h.active')).toHaveCount(1);
    // A reload keeps every axis (no writer drops another's params).
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/f\.stage=New/);
    await expect(page).toHaveURL(/q=a/);
  });

  test('a row-action click never opens the row', async ({ page }) => {
    await openTable(page, '/pos/accounts');
    await skipWhenEmpty(page);
    const action = rows(page).first().locator('td.dt-act button').first();
    test.skip((await action.count()) === 0, 'No row action on the seeded rows.');
    const before = page.url();
    await action.click();
    // `rowActions` stops the click reaching `onRowClick` (which here opens a
    // drawer and rewrites the URL), so the location must be untouched.
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
  });

  test('an inline edit restores the committed value on Escape', async ({ page }) => {
    await openTable(page, '/pos/catalog');
    await skipWhenEmpty(page);
    const cell = rows(page).first().locator('td.dt-editable').first();
    test.skip((await cell.count()) === 0, 'No editable cell on the seeded rows.');
    const before = (await cell.innerText()).trim();
    await cell.dblclick();
    const editor = page.locator('td.dt-editing input.dt-inp');
    await expect(editor).toBeVisible();
    await editor.fill('12345');
    await editor.press('Escape');
    await expect(page.locator('td.dt-editing')).toHaveCount(0);
    await expect.poll(async () => (await cell.innerText()).trim()).toBe(before);
  });

  test('a groupBy header collapses and expands its rows', async ({ page }) => {
    // The axis is a per-user preference; seed it instead of driving the picker.
    await page.addInitScript(() =>
      window.localStorage.setItem('pos-catalog-table-axis', 'category'),
    );
    await openTable(page, '/pos/catalog');
    await skipWhenEmpty(page);
    const group = page.locator('tr.dt-group-row').first();
    await expect(group).toBeVisible();
    const open = await rows(page).count();
    await group.locator('button.dt-exp').click();
    await expect.poll(() => rows(page).count(), { timeout: 10_000 }).toBeLessThan(open);
    await group.locator('button.dt-exp').click();
    await expect.poll(() => rows(page).count(), { timeout: 10_000 }).toBe(open);
  });
}

test.describe('DataTable interactions — desktop', () => {
  tableScenarios(1280, 800);
});

// Same contract on a phone: the toolbar wraps and the chip bar stacks, but
// sorting, filtering and the URL mirror are the same code path.
test.describe('DataTable interactions — mobile 390', () => {
  tableScenarios(390, 844);
});
