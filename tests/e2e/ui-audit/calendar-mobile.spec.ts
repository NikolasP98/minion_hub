/**
 * UI-04 — multi-staff Calendar composition at supported mobile widths.
 *
 * Red before the 13-02 repair (measured on the same fixture, 390x844):
 *   six resource columns were squeezed to 47px each with wrapped/ellipsed staff
 *   names and 41px appointment chips, and PageBody `scroll="none"` clipped the
 *   1454px day grid inside a 663px region — every appointment past ~11:45 was
 *   unreachable in any direction.
 *
 * See mobile-fixture.ts for how to run this.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  MOBILE_FIXTURE_URL,
  MOBILE_FIXTURE_HINT,
  MOBILE_WIDTHS,
  DESKTOP_CONTROL,
} from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

/** Readability floor for one staff lane in the day grid (`--cal-lane-min`). */
const MIN_LANE_PX = 112;
const FIXTURE_STAFF = [
  'Leiva',
  'Martin',
  'Nikolas Pinon',
  'Nikolas Sarria',
  'Nikolas Sebastian Pinon Sarria',
  'Renzo GT',
];

async function openCalendar(page: Page, width: number, height: number, query = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html${query}`);
  // Positive control: the real route component mounted with its toolbar.
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.cal-body .ec')).toBeVisible();
}

function metrics(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-part="page-body"].cal-body') as HTMLElement;
    const lanes = [...document.querySelectorAll('.ec-header .ec-day')].map((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    const events = [...document.querySelectorAll('.ec-event')].map((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    return {
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      lanes,
      events,
    };
  });
}

for (const viewport of MOBILE_WIDTHS) {
  test(`Every staff lane stays readable and reachable at ${viewport.id}`, async ({ page }) => {
    await openCalendar(page, viewport.width, viewport.height);
    const m = await metrics(page);

    // The page itself never scrolls sideways; the schedule region does.
    expect(m.docScrollWidth).toBe(m.docClientWidth);
    expect(m.bodyScrollWidth).toBeGreaterThan(m.bodyClientWidth);

    // Six lanes, none compressed below the readability floor.
    expect(m.lanes).toHaveLength(FIXTURE_STAFF.length);
    for (const lane of m.lanes) expect(lane).toBeGreaterThanOrEqual(MIN_LANE_PX);

    // Every staff schedule can be reached: each name is in the header, and the
    // region scrolls far enough to bring the last lane fully into view.
    for (const name of FIXTURE_STAFF) {
      await expect(page.locator('.ec-header').getByText(name, { exact: true })).toHaveCount(1);
    }
    const lastLane = page.locator('.ec-header .ec-day').last();
    await lastLane.scrollIntoViewIfNeeded();
    const lastBox = await lastLane.boundingBox();
    expect(lastBox?.width ?? 0).toBeGreaterThanOrEqual(MIN_LANE_PX);
    expect(lastBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((lastBox?.x ?? 0) + (lastBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);

    // Appointments keep a usable chip and the grid scrolls vertically instead
    // of clipping the rest of the day.
    expect(m.events.length).toBeGreaterThan(0);
    for (const width of m.events) expect(width).toBeGreaterThan(MIN_LANE_PX * 0.4);
    expect(m.bodyScrollHeight).toBeGreaterThan(m.bodyClientHeight);
    await page.locator('[data-part="page-body"].cal-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(
      await page.locator('[data-part="page-body"].cal-body').evaluate((el) => el.scrollTop > 0),
    ).toBe(true);
  });
}

test('Scheduling actions stay operable at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openCalendar(page, compact.width, compact.height);

  // View switch, staff filter and date navigation are all reachable controls
  // inside the viewport, not clipped toolbar overflow.
  for (const name of ['Day', 'Week', 'Month', 'Agenda', 'Today']) {
    const control = page.getByRole('button', { name, exact: true }).first();
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(compact.width);
  }
  await expect(page.getByRole('button', { name: /staff/i }).first()).toBeVisible();
});

test('A single-staff selection needs no sideways scroll at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openCalendar(page, compact.width, compact.height, '?staff=r1');
  const m = await metrics(page);
  expect(m.lanes).toHaveLength(1);
  expect(m.bodyScrollWidth).toBe(m.bodyClientWidth);
  expect(m.docScrollWidth).toBe(m.docClientWidth);
});

for (const view of ['month', 'agenda'] as const) {
  test(`The ${view} view keeps the container width at 390px`, async ({ page }) => {
    const compact = MOBILE_WIDTHS[1];
    await openCalendar(page, compact.width, compact.height, `?view=${view}`);
    const m = await metrics(page);
    expect(m.bodyScrollWidth).toBe(m.bodyClientWidth);
    expect(m.docScrollWidth).toBe(m.docClientWidth);
  });
}

test('Desktop calendar composition is unchanged by the compact repair', async ({ page }) => {
  await openCalendar(page, DESKTOP_CONTROL.width, DESKTOP_CONTROL.height);
  const m = await metrics(page);
  expect(m.docScrollWidth).toBe(m.docClientWidth);
  // The minimum-width floor is inert once the lanes already exceed it.
  expect(m.bodyScrollWidth).toBe(m.bodyClientWidth);
  for (const lane of m.lanes) expect(lane).toBeGreaterThan(MIN_LANE_PX);
});
