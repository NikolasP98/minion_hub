/**
 * UI-04 — multi-staff Calendar composition at supported mobile widths.
 *
 * Red before the 13-02 repair (measured on the same fixture, 390x844):
 *   six resource columns were squeezed to 47px each with wrapped/ellipsed staff
 *   names and 41px appointment chips, and PageBody `scroll="none"` clipped the
 *   1454px day grid inside a 663px region — every appointment past ~11:45 was
 *   unreachable in any direction.
 *
 * Ported to `BookingCalendar` (spec 2026-09-27 S3), which replaced
 * `@event-calendar/core` on `/scheduling/calendar`. What moved:
 *   - the scroll owner is the grid's own `.cal-scroll`, not a `PageBody` region;
 *   - the readability floor is the component's `.col { min-width: 132px }`
 *     rather than the route's `--cal-lane-min`;
 *   - day view draws an aggregate "All" column BEFORE the resource columns, so
 *     the lane count is one more than the number of staff;
 *   - the date control is a month-grid Popover, not a native `<input type=date>`
 *     (so the `showPicker`-absence fallback spec has no subject any more).
 *
 * See mobile-fixture.ts for how to run this.
 */
import { expect, type Page } from '@playwright/test';
import {
  test,
  MOBILE_FIXTURE_URL,
  MOBILE_FIXTURE_HINT,
  MOBILE_WIDTHS,
  DESKTOP_CONTROL,
} from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

/** Readability floor for one lane in the day grid (`.col { min-width }`). */
const MIN_LANE_PX = 112;
const FIXTURE_STAFF = [
  'Leiva',
  'Martin',
  'Nikolas Pinon',
  'Nikolas Sarria',
  'Nikolas Sebastian Pinon Sarria',
  'Renzo GT',
];
/** Day view = the aggregate "All" column plus one per staff member. */
const DAY_LANES = FIXTURE_STAFF.length + 1;

async function openCalendar(page: Page, width: number, height: number, query = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html${query}`);
  await page.evaluate(() => document.fonts.ready);
  // Positive control: the real route component mounted with its toolbar.
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
}

function metrics(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector('.cal-scroll') as HTMLElement;
    const lanes = [...document.querySelectorAll('.col-head')].map((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    const events = [...document.querySelectorAll('.evt')].map((el) =>
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

    // Aggregate + six staff lanes, none compressed below the readability floor.
    expect(m.lanes).toHaveLength(DAY_LANES);
    for (const lane of m.lanes) expect(lane).toBeGreaterThanOrEqual(MIN_LANE_PX);

    // Every staff schedule can be reached: each name is in a column head, and
    // the region scrolls far enough to bring the last lane fully into view.
    for (const name of FIXTURE_STAFF) {
      await expect(
        page.locator('.col-head .head-name').getByText(name, { exact: true }),
      ).toHaveCount(1);
    }
    const lastLane = page.locator('.col-head').last();
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
    await page.locator('.cal-scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await page.locator('.cal-scroll').evaluate((el) => el.scrollTop > 0)).toBe(true);
  });
}

test('Scheduling navigation controls expose their view intents at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openCalendar(page, compact.width, compact.height);

  // View switch, staff filter and date navigation are all reachable controls
  // inside the viewport, not clipped toolbar overflow.
  for (const name of ['Day', 'Week', 'Month', 'Agenda', 'Today']) {
    const control = page.getByRole('button', { name, exact: true }).first();
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(compact.width);
    if (name !== 'Today' && name !== 'Day') {
      await control.click();
      const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
      expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('view')).toBe(
        name.toLowerCase(),
      );
    }
  }
  await expect(page.getByRole('button', { name: /staff/i }).first()).toBeVisible();
});

test('A single-staff selection needs no sideways scroll at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openCalendar(page, compact.width, compact.height, '?staff=r1');
  const m = await metrics(page);
  // The aggregate column plus the one selected staff lane.
  expect(m.lanes).toHaveLength(2);
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
  for (const lane of m.lanes) expect(lane).toBeGreaterThan(MIN_LANE_PX);
});

test('The first booking aligns with its viewer-local 08:00 slot', async ({ page }) => {
  await openCalendar(page, 390, 844);
  const event = page.locator('.col:not(.is-all) .evt').filter({ hasText: 'Paciente 1A' });
  await expect(event).toContainText('08:00');
  const position = await event.evaluate((el) => {
    const track = document.querySelector('.col:not(.is-all) .track')!;
    // 07:00..21:00 renders FIFTEEN hour rows — `endHour` keeps a full row of its
    // own (`TRACK_H` in BookingCalendar), so the divisor is 15, not 14.
    return {
      top: parseFloat((el as HTMLElement).style.top),
      hourHeight: track.getBoundingClientRect().height / 15,
    };
  });
  // The grid displays 07:00–21:00; 08:00 is one hour below its origin.
  expect(position.top).toBeCloseTo(position.hourHeight, 0);
  await page.screenshot({ path: test.info().outputPath('calendar-viewer-local.png') });
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 600, height: 390 },
]) {
  test(`Calendar toolbar targets remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await openCalendar(page, viewport.width, viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    const toolbar = page.locator('.cal-toolbar');
    const targets = toolbar.locator('button, select');
    expect(await targets.count()).toBeGreaterThanOrEqual(9);
    for (const target of await targets.all()) {
      if (!(await target.isVisible())) continue; // Closed popover options are not active targets.
      const rect = await target.boundingBox();
      if (!rect) throw new Error('Missing toolbar target');
      expect(rect.height, (await target.textContent()) ?? 'toolbar control').toBeGreaterThanOrEqual(
        44,
      );
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({ path: test.info().outputPath('calendar-toolbar.png') });
  });
}

test.describe('fine-pointer toolbar', () => {
  test.use({ hasTouch: false });
  test('retains compact desktop controls and keyboard view intent', async ({ page }) => {
    await openCalendar(page, 1440, 900);
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    const today = page.getByRole('button', { name: 'Today', exact: true });
    expect((await today.boundingBox())?.height).toBe(28);
    // The shared grid's view switcher renders `SegmentedControl` at its own
    // default size (22px items); the retired toolbar sized it at 26.
    const week = page.getByRole('button', { name: 'Week', exact: true });
    expect((await week.boundingBox())?.height).toBe(22);
    await week.focus();
    await page.keyboard.press('Enter');
    const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
    expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('view')).toBe('week');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  });
});

test('Staff and event-type filters narrow the grid without a navigation', async ({ page }) => {
  await openCalendar(page, 390, 844);
  const before = (await metrics(page)).lanes.length;
  expect(before).toBe(DAY_LANES);

  // Staff and kind are CLIENT-SIDE filters now (spec 2026-09-27 S3): they narrow
  // the loaded window in place instead of re-running the load through the URL.
  // Located by class, not by accessible name: picking a member swaps the
  // trigger's label from "All staff" to the selected count.
  const staff = page.locator('.cal-staff-filter button').first();
  await staff.focus();
  await page.keyboard.press('Enter');
  const leiva = page.getByRole('option', { name: 'Leiva', exact: true });
  await expect(leiva).toBeVisible();
  expect((await leiva.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await leiva.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await metrics(page)).lanes.length).toBe(2);
  await page.keyboard.press('Escape');
  await expect(leiva).not.toBeVisible();
  await expect(staff).toBeFocused();

  const kind = page.getByRole('combobox', { name: 'Event type', exact: true });
  await kind.focus();
  await expect(kind).toBeFocused();
  const eventsBefore = (await metrics(page)).events.length;
  await kind.selectOption('k2');
  // Only the `k2` half of Leiva's two bookings survives the kind filter.
  await expect.poll(async () => (await metrics(page)).events.length).toBeLessThan(eventsBefore);
});

test('The date picker keeps a reachable month grid and emits a date intent', async ({ page }) => {
  await openCalendar(page, 320, 740);
  // The range label IS the picker trigger (`features.datePicker`).
  await page.locator('.cal-date').click();
  // The grid pads with the adjacent months' days, so "10" appears twice — take
  // the one inside September (the non-muted cell). The label carries the
  // Button's own padding whitespace, so the match is anchored around it.
  const tenth = page.locator('.dp-grid .dp-day:not(.is-muted)').filter({ hasText: /^\s*10\s*$/ });
  await expect(tenth).toBeVisible();
  await tenth.click();
  const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('date')).toBe('2026-09-10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('Selected staff chips stay a usable target and clear back to all staff at 320px', async ({
  page,
}) => {
  await openCalendar(page, 320, 740, '?staff=r5');
  const remove = page.getByRole('button', {
    name: 'Remove Nikolas Sebastian Pinon Sarria',
    exact: true,
  });
  await expect(remove).toBeVisible();
  const box = await remove.boundingBox();
  if (!box) throw new Error('Missing staff removal target');
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await remove.focus();
  await page.keyboard.press('Enter');
  // Back to every lane, in place.
  await expect.poll(async () => (await metrics(page)).lanes.length).toBe(DAY_LANES);
});
