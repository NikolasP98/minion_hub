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
 *
 * Spec 145 S1 (calendar on phones): below the phone query
 * `(max-width: 767.98px), ((pointer: coarse) and (max-height: 500px))` the
 * toolbar is ONE compact row (date button, view button, Filters button, "…"),
 * with the date picker / view choice / filters inside bottom sheets, plus a
 * week strip and a floating "+". 768 and wider keep the desktop toolbar.
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
  await expect(page.locator('.cal-root .cal-toolbar')).toBeVisible();
  await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
  const compact = await page.evaluate(() => !!document.querySelector('.cal-toolbar.is-compact'));
  if (!compact) await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
}

/** Phone toolbar controls (compact mode only). */
const dateBtn = (page: Page) => page.locator('.cal-toolbar.is-compact .cc-date-btn');
const viewBtn = (page: Page) => page.locator('.cal-toolbar.is-compact .cc-view-btn');
const filtersBtn = (page: Page) =>
  page.locator('.cal-toolbar.is-compact').getByRole('button', { name: /^Filters/ });
const moreBtn = (page: Page) =>
  page.locator('.cal-toolbar.is-compact').getByRole('button', { name: /^Calendar options/ });

/** Open the Filters bottom sheet (staff filter, kind select, tags, linked-tags switch). */
async function openFilters(page: Page) {
  await filtersBtn(page).click();
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
}

/** Open the View sheet and choose a row by its label. */
async function chooseView(page: Page, label: 'Day' | '3 days' | 'Month' | 'List') {
  await viewBtn(page).click();
  await page.getByRole('radio', { name: label, exact: true }).click();
}

function metrics(page: Page) {
  return page.evaluate(() => {
    const body = document.querySelector('.cal-scroll') as HTMLElement;
    const lanes = [...document.querySelectorAll('.col-head')].map((el) =>
      Math.round(el.getBoundingClientRect().width),
    );
    // Staff lanes only: the aggregate "All" lane splits overlapping bookings
    // side by side, so its chips are narrower by design (41px at 768 and 390).
    const events = [...document.querySelectorAll('.col:not(.is-all) .evt')].map((el) =>
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

  // View choice, staff filter and date navigation are all reachable: the view
  // rows live in the View sheet, the staff filter in the Filters sheet and
  // Today in the date sheet — each opened from a visible toolbar button.
  for (const [label, view] of [
    ['Month', 'month'],
    ['List', 'agenda'],
    ['3 days', 'week'],
    ['Day', 'day'],
  ] as const) {
    await chooseView(page, label);
    const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
    expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('view')).toBe(view);
  }
  await dateBtn(page).click();
  await expect(
    page.getByRole('dialog', { name: 'Date' }).getByRole('button', { name: 'Today' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await openFilters(page);
  await expect(page.getByRole('button', { name: /staff/i }).first()).toBeVisible();
});

test('Scheduling navigation controls expose their view intents at 768px', async ({ page }) => {
  const medium = MOBILE_WIDTHS[2];
  await openCalendar(page, medium.width, medium.height);

  // Not a phone: the desktop toolbar keeps its buttons inline.
  for (const name of ['Day', 'Week', 'Month', 'Agenda', 'Today']) {
    const control = page.getByRole('button', { name, exact: true }).first();
    await expect(control).toBeVisible();
    const rect = await control.boundingBox();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(medium.width);
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

// #434: the day view drops the aggregate column beside a single staff column,
// so a one-staff day view is ONE lane (re-baselined from the old "All + staff" 2).
test('A single-staff selection needs no sideways scroll at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openCalendar(page, compact.width, compact.height, '?staff=r1');
  const m = await metrics(page);
  expect(m.lanes).toHaveLength(1);
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

// The 44px floors (switch hit box, desktop controls at 768) are coarse-pointer contracts.
test.describe('toolbar targets (touch)', () => {
  test.use({ hasTouch: true });
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
      // Phone toolbar: exactly the date button, the view button, Filters and "…".
      const toolbar = page.locator('.cal-toolbar.is-compact');
      const targets = toolbar.locator('button, select, [role="switch"]');
      expect(await targets.count()).toBe(4);
      await expect(dateBtn(page)).toBeVisible();
      await expect(viewBtn(page)).toBeVisible();
      await expect(filtersBtn(page)).toBeVisible();
      await expect(moreBtn(page)).toBeVisible();
      for (const target of await targets.all()) {
        const rect = await target.boundingBox();
        if (!rect) throw new Error('Missing toolbar target');
        const name =
          (await target.getAttribute('aria-label')) ?? (await target.textContent()) ?? '';
        expect(rect.height, name).toBeGreaterThanOrEqual(44);
        expect(rect.width, name).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
      }
      // A 44px target is only usable if it is DISTINCT (UI-002): no two controls
      // intersect and the row does not scroll sideways.
      const layout = await toolbarLayout(page);
      expect(layout.overlaps, 'no two toolbar controls intersect').toEqual([]);
      expect(layout.groupsOverflowing, 'segmented groups contain their buttons').toEqual([]);
      expect(layout.toolbarScrollWidth).toBeLessThanOrEqual(layout.toolbarClientWidth);
      await page.screenshot({ path: test.info().outputPath('calendar-toolbar.png') });

      // The linked-tags switch moved into the Filters sheet: it keeps its track
      // and carries its 44px target as a hit box; its label wraps to <= 2 lines.
      await openFilters(page);
      // The sheet slides in: poll until the switch has settled under the pointer.
      await expect
        .poll(async () => (await switchLayout(page)).switchHit44, {
          message: 'switch keeps a 44px hit box around its track',
        })
        .toBe(true);
      expect((await switchLayout(page)).switchLabelLines).toBeLessThanOrEqual(2);
    });
  }

  // UI-002 regression, measured on this branch (390x844 sheet and 768x1024
  // toolbar, coarse pointer): the linked-tags switch box is 44x44 — the 44px
  // floor makes the track a disc instead of a track inside a 44px hit box.
  // Toggle.svelte / app.css are untouched by this branch.
  test.fixme('UI-002: the linked-tags switch keeps a track shorter than its 44px hit box (Filters sheet, 390px)', async ({
    page,
  }) => {
    await openCalendar(page, 390, 844);
    await openFilters(page);
    expect((await switchLayout(page)).switchTrackHeight).toBeLessThan(44);
  });

  test('Calendar toolbar targets remain usable at 768x1024 (desktop toolbar)', async ({ page }) => {
    await openCalendar(page, 768, 1024);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
    await expect(page.locator('.cal-toolbar.is-compact')).toHaveCount(0);
    const toolbar = page.locator('.cal-toolbar');
    // The switch keeps its track and carries its 44px target as a hit box (UI-002,
    // asserted below through elementFromPoint), so its box is not a size target.
    const targets = toolbar.locator('button:not([role="switch"]), select');
    expect(await targets.count()).toBeGreaterThanOrEqual(9);
    const layout = await toolbarLayout(page);
    expect(layout.overlaps, 'no two toolbar controls intersect').toEqual([]);
    expect(layout.groupsOverflowing, 'segmented groups contain their buttons').toEqual([]);
    expect(layout.toolbarScrollWidth).toBeLessThanOrEqual(layout.toolbarClientWidth);
    const sw = await switchLayout(page);
    expect(sw.switchHit44, 'switch keeps a 44px hit box around its track').toBe(true);
    expect(sw.switchLabelLines).toBeLessThanOrEqual(2);
  });

  test.fixme('UI-002: the linked-tags switch keeps a track shorter than its 44px hit box (toolbar, 768px)', async ({
    page,
  }) => {
    await openCalendar(page, 768, 1024);
    expect((await switchLayout(page)).switchTrackHeight).toBeLessThan(44);
  });
});

/** Geometry of every visible toolbar control, read in one evaluate. */
function toolbarLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const name = (el: Element) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
    const toolbar = document.querySelector('.cal-toolbar') as HTMLElement;
    const controls = [...toolbar.querySelectorAll('button, select, [role="switch"]')].filter(
      (el) => box(el).width > 0 && box(el).height > 0,
    );
    const meets = (a: DOMRect, b: DOMRect) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i++)
      for (let j = i + 1; j < controls.length; j++)
        if (!controls[i].contains(controls[j]) && meets(box(controls[i]), box(controls[j])))
          overlaps.push(`${name(controls[i])} ∩ ${name(controls[j])}`);
    const groupsOverflowing = [...toolbar.querySelectorAll('.seg')]
      .filter((g) =>
        [...g.querySelectorAll('button')].some((b) => box(b).bottom > box(g).bottom + 1),
      )
      .map((g) => g.getAttribute('aria-label'));
    return {
      overlaps,
      groupsOverflowing,
      toolbarScrollWidth: toolbar.scrollWidth,
      toolbarClientWidth: toolbar.clientWidth,
    };
  });
}

/** Linked-tags switch geometry, wherever it renders (toolbar or Filters sheet). */
function switchLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect();
    const sw = document.querySelector('[role="switch"]') as HTMLElement;
    sw.scrollIntoView({ block: 'center' }); // a short sheet scrolls; hit-testing needs it on screen
    const sr = box(sw);
    const cx = sr.left + sr.width / 2;
    const cy = sr.top + sr.height / 2;
    const hits = (dx: number, dy: number) =>
      sw.contains(document.elementFromPoint(cx + dx, cy + dy));
    const label = sw.parentElement?.querySelector(':scope > span.min-w-0') as HTMLElement;
    const lineHeight = parseFloat(getComputedStyle(label.firstElementChild ?? label).lineHeight);
    return {
      switchTrackHeight: sr.height,
      switchHit44: hits(0, -21) && hits(0, 21) && hits(-21, 0) && hits(21, 0),
      switchLabelLines: Math.round(box(label).height / lineHeight),
    };
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

for (const viewport of [
  { width: 390, height: 844, phone: true },
  { width: 768, height: 1024, phone: false },
]) {
  test(`Staff and event-type filters narrow the grid without a navigation at ${viewport.width}px`, async ({
    page,
  }) => {
    await openCalendar(page, viewport.width, viewport.height);
    const before = (await metrics(page)).lanes.length;
    expect(before).toBe(DAY_LANES);
    // On a phone the filters live in the Filters sheet.
    if (viewport.phone) await openFilters(page);
    const navBefore = await page.evaluate(() => (Reflect.get(window, '__fixtureNav') ?? []).length);

    // Staff and kind are CLIENT-SIDE filters now (spec 2026-09-27 S3): they narrow
    // the loaded window in place instead of re-running the load through the URL.
    // Located by class, not by accessible name: picking a member swaps the
    // trigger's label from "All staff" to the selected count.
    const staff = page.locator('.cal-staff-filter button').first();
    await staff.focus();
    await page.keyboard.press('Enter');
    const leiva = page.getByRole('option', { name: 'Leiva', exact: true });
    await expect(leiva).toBeVisible();
    // 44px option targets are a phone contract; the 768 fine-pointer picker keeps 30px rows.
    if (viewport.phone) expect((await leiva.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await leiva.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await metrics(page)).lanes.length).toBe(1); // #434: one staff = one lane
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
    // No navigation intent was recorded by any of it.
    expect(await page.evaluate(() => (Reflect.get(window, '__fixtureNav') ?? []).length)).toBe(
      navBefore,
    );
  });
}

test('The date picker keeps a reachable month grid and emits a date intent', async ({ page }) => {
  await openCalendar(page, 320, 740);
  // On a phone the date button opens the Date sheet holding the month picker.
  await dateBtn(page).click();
  // The grid pads with the adjacent months' days, so "10" appears twice — take
  // the one inside September (the non-muted cell). The label carries the
  // Button's own padding whitespace, so the match is anchored around it.
  const tenth = page.locator('.dp-grid .dp-day:not(.is-muted)').filter({ hasText: /^\s*10\s*$/ });
  await expect(tenth).toBeVisible();
  const rect = await tenth.boundingBox();
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
  await tenth.click();
  const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('date')).toBe('2026-09-10');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('The date picker keeps a reachable month grid and emits a date intent at 768px', async ({
  page,
}) => {
  await openCalendar(page, 768, 1024);
  // The range label IS the picker trigger (`features.datePicker`).
  await page.locator('.cal-date').click();
  const tenth = page.locator('.dp-grid .dp-day:not(.is-muted)').filter({ hasText: /^\s*10\s*$/ });
  await expect(tenth).toBeVisible();
  await tenth.click();
  const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('date')).toBe('2026-09-10');
});

test('Selected staff chips stay a usable target and clear back to all staff at 320px', async ({
  page,
}) => {
  await openCalendar(page, 320, 740, '?staff=r5');
  await openFilters(page);
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

// ── Spec 145 S1: calendar on phones ─────────────────────────────────────────

const strip = (page: Page) => page.locator('.strip .days button');
const selectedDay = (page: Page) => page.locator('.strip .days button[aria-current="date"]');

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`S1: phone opens on Day with a short chrome and no sideways scroll at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await openCalendar(page, viewport.width, viewport.height);
    // No `?view=` in the address: a phone defaults to Day (one lane per staff
    // plus the aggregate), not the desktop week.
    expect(await page.locator('.col-head').count()).toBe(DAY_LANES);
    expect(await page.locator('.cal-root').getAttribute('class')).not.toMatch(/is-week/);
    await expect(viewBtn(page)).toContainText('Day');
    // Everything above the day header — toolbar row + week strip — leaves the
    // grid within 104px (the app's 56px top bar brings the total to 160).
    const top = await page.evaluate(() => {
      const root = document.querySelector('.is-compact-calendar') as HTMLElement;
      const scroll = document.querySelector('.cal-scroll') as HTMLElement;
      return scroll.getBoundingClientRect().top - root.getBoundingClientRect().top;
    });
    expect(top).toBeLessThanOrEqual(104);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('S1: the compact toolbar is exactly one row of 44px controls', async ({ page }) => {
  await openCalendar(page, 390, 844);
  const rects = await page
    .locator('.cal-toolbar.is-compact')
    .locator('button, select, [role="switch"]')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
  expect(rects).toHaveLength(4);
  const tops = rects.map((r) => r.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  for (const r of rects) {
    expect(r.width).toBeGreaterThanOrEqual(44);
    expect(r.height).toBeGreaterThanOrEqual(44);
  }
});

test('S1: the week strip selects a day and steps a week at a time', async ({ page }) => {
  await openCalendar(page, 390, 844);
  await expect(strip(page)).toHaveCount(7);
  await expect(page.locator('.strip .days button[aria-current="date"]')).toHaveCount(1);
  await expect(selectedDay(page)).toHaveAccessibleName(/September 8/);
  await expect(dateBtn(page)).toContainText('Sep 8');

  // Tapping another day moves the selection and the calendar's date label.
  await strip(page).nth(3).click(); // Thu Sep 10
  await expect(selectedDay(page)).toHaveAccessibleName(/September 10/);
  await expect(selectedDay(page)).toHaveCount(1);
  await expect(dateBtn(page)).toContainText('Sep 10');

  // Previous / next week move the strip by 7 days.
  const first = () => strip(page).first().locator('.sr-only').textContent();
  const week0 = await first();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(selectedDay(page)).toHaveAccessibleName(/September 17/);
  expect(await first()).not.toBe(week0);
  expect(await first()).toMatch(/September 14/);
  await page.getByRole('button', { name: 'Previous week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(selectedDay(page)).toHaveAccessibleName(/September 3/);
  expect(await first()).toMatch(/August 31/);
});

test('S1: the view sheet offers Day, 3 days, Month and List; 3 days starts on the selected date', async ({
  page,
}) => {
  await openCalendar(page, 390, 844);
  await strip(page).nth(3).click(); // Thu Sep 10 — not a Monday
  await viewBtn(page).click();
  const radios = page.getByRole('dialog', { name: 'View' }).getByRole('radio');
  await expect(radios).toHaveText(['Day', '3 days', 'Month', 'List']);
  await expect(page.getByRole('radio', { name: 'Day', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('radio', { name: 'Month', exact: true })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('radio', { name: '3 days', exact: true }).click();
  await expect(viewBtn(page)).toContainText('3 days');
  // Three day columns are on screen; the first is Thursday the 10th, not its Monday.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const scroll = document.querySelector('.cal-scroll') as HTMLElement;
        const sr = scroll.getBoundingClientRect();
        return [...document.querySelectorAll('.col-head')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left >= sr.left - 2 && r.right <= sr.right + 2;
          })
          .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
      }),
    )
    .toHaveLength(3);
  const heads = await page.evaluate(() => {
    const sr = (document.querySelector('.cal-scroll') as HTMLElement).getBoundingClientRect();
    return [...document.querySelectorAll('.col-head')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left >= sr.left - 2 && r.right <= sr.right + 2;
      })
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());
  });
  expect(heads[0]).toMatch(/10/);
  expect(heads[0]).not.toMatch(/\b7\b/);
});

test.describe('S1: landscape phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });
  test('shows the compact toolbar and hides the week strip', async ({ page }) => {
    await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html`);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await expect(page.locator('.cal-toolbar.is-compact')).toBeVisible();
    await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
    await expect(page.locator('.strip')).toBeHidden();
    await expect(page.locator('.cal-toolbar:not(.is-compact)')).toHaveCount(0);
  });
});

test('S1: the floating "+" clears the grid and stays on the corner', async ({ page }) => {
  await openCalendar(page, 390, 844);
  const add = page.locator('.cal-add');
  await expect(add).toBeVisible();
  const r = (await add.boundingBox())!;
  expect(Math.round(r.width)).toBe(56);
  expect(Math.round(r.height)).toBe(56);
  expect(390 - (r.x + r.width)).toBeGreaterThanOrEqual(16);
  expect(390 - (r.x + r.width)).toBeLessThanOrEqual(24);
  expect(844 - (r.y + r.height)).toBeGreaterThanOrEqual(16);
  expect(844 - (r.y + r.height)).toBeLessThanOrEqual(24);
  // The scroller reserves room: at its end the last hour row ends above the button.
  await page.locator('.cal-scroll').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const track = document.querySelector('.col:not(.is-all) .track') as HTMLElement;
        const btn = document.querySelector('.cal-add') as HTMLElement;
        return btn.getBoundingClientRect().top - track.getBoundingClientRect().bottom;
      }),
    )
    .toBeGreaterThan(0);
});

test('S1: resizing 390 -> 1024 -> 390 keeps the selected date', async ({ page }) => {
  await openCalendar(page, 390, 844);
  await strip(page).nth(3).click(); // Thu Sep 10
  await expect(dateBtn(page)).toContainText('Sep 10');
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.cal-toolbar:not(.is-compact)')).toBeVisible();
  await expect(page.locator('.cal-date')).toContainText('10');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dateBtn(page)).toContainText('Sep 10');
  await expect(selectedDay(page)).toHaveAccessibleName(/September 10/);
});
