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
import { expect, type Page } from '@playwright/test';
import {
  test,
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
  await page.evaluate(() => document.fonts.ready);
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

test('The first booking aligns with its viewer-local 08:00 slot', async ({ page }) => {
  await openCalendar(page, 390, 844);
  const event = page.locator('.ec-event').filter({ hasText: 'Paciente 1A' });
  await expect(event).toContainText('08:00');
  const position = await event.evaluate((el) => {
    const body = document.querySelector('.ec-body')!;
    return {
      top: parseFloat((el as HTMLElement).style.insetBlockStart),
      hourHeight: body.getBoundingClientRect().height / 14,
    };
  });
  // The real fixture displays 07:00–21:00; 08:00 is one hour below its origin.
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
      if (!(await target.isVisible())) continue; // Closed staff popover options are not active targets.
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
    const week = page.getByRole('button', { name: 'Week', exact: true });
    expect((await week.boundingBox())?.height).toBe(26);
    await week.focus();
    await page.keyboard.press('Enter');
    const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
    expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('view')).toBe('week');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  });
});

test('Date and staff/type filters retain native keyboard and URL intent behavior', async ({
  page,
}) => {
  await openCalendar(page, 390, 844);
  const staff = page.getByRole('button', { name: /Staff.*All staff/i });
  await staff.focus();
  await page.keyboard.press('Enter');
  const leiva = page.getByRole('option', { name: 'Leiva', exact: true });
  await expect(leiva).toBeVisible();
  expect((await leiva.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await leiva.focus();
  await page.keyboard.press('Enter');
  let intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('staff')).toBe('r1');
  await page.keyboard.press('Escape');
  await expect(leiva).not.toBeVisible();
  await expect(staff).toBeFocused();

  const kind = page.getByRole('combobox', { name: 'Event type', exact: true });
  await kind.focus();
  await expect(kind).toBeFocused();
  await kind.selectOption('k2');
  intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('kind')).toBe('k2');

  const dateButton = page.locator('.cal-date-wrap').getByRole('button');
  await dateButton.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const date = page.getByLabel('Pick a date', { exact: true });
  await date.fill('2026-09-10');
  intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('date')).toBe('2026-09-10');
});

test('Selected staff targets fit and keyboard traversal skips an invisible date input', async ({
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
  const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.has('staff')).toBe(false);

  const dateButton = page.locator('.cal-date-wrap').getByRole('button');
  await dateButton.focus();
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => 'showPicker' in HTMLInputElement.prototype)) {
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeFocused();
  } else {
    await expect(page.getByLabel('Pick a date', { exact: true })).toBeFocused();
  }
});

test('Date picker absence keeps a visible usable fallback at 320px', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });
  await openCalendar(page, 320, 740);
  expect(await page.evaluate(() => 'showPicker' in HTMLInputElement.prototype)).toBe(false);
  const input = page.getByLabel('Pick a date', { exact: true });
  await expect(input).toBeVisible();
  expect(await input.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  expect((await input.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.locator('.cal-date-wrap').getByRole('button').click();
  await expect(input).toBeFocused();
  await input.fill('2026-09-12');
  const intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  expect(new URL(intents.at(-1)!, MOBILE_FIXTURE_URL).searchParams.get('date')).toBe('2026-09-12');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
