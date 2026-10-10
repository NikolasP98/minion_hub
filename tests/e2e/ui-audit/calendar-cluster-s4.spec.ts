/**
 * Calendar cluster slice S4 — HC-016 (runway anchor across a view switch),
 * HC-021 (month = navigation/signal view), HC-022 (containment of
 * out-of-hours bookings) and HC-023 (truncated headers reachable without
 * hover), on the isolated mobile-composition fixture (see mobile-fixture.ts
 * for how to run this). The fixture mounts the REAL `/scheduling/calendar`
 * route; its `goto` stub replays `?view=`/`?date=` intents into the route's
 * `data`, which is what makes the Calendar → Table → Calendar round trip a
 * real unmount/remount of `BookingCalendar`.
 *
 * Red on master `c4379573` (same fixture build):
 *   HC-022 — the 06:00–07:20 box paints 56px ABOVE its track (under the sticky
 *            head) and the 21:30–22:30 box 28px below it; no markers.
 *   HC-023 — column heads carry a native `title`; a tap/Tab shows nothing.
 *   HC-016 — after Table → Calendar the runway re-anchors on Monday at
 *            `scrollTop` 0 and re-emits the range.
 *   HC-021 — month chips have no hover card; a drag attempt shows nothing.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { test, MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT } from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

const WIDTHS = [
  { id: 'compact-390', width: 390, height: 844 },
  { id: 'medium-portrait', width: 768, height: 1024 },
  { id: 'wide-1280', width: 1280, height: 800 },
] as const;

async function openCalendar(page: Page, width: number, height: number, query = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html${query}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.locator(query.includes('view=board') ? '.board' : '.cal-root .cal-scroll'),
  ).toBeVisible();
}

/** The box in a RESOURCE column (day view also draws the aggregate column). */
const eventBox = (page: Page, name: string): Locator =>
  page.locator('.col:not(.is-all) .evt').filter({ hasText: name });

const rect = (l: Locator) =>
  l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  });

/** Stub the reschedule PATCH (the fixture has no server) and count the bodies. */
async function stubPatch(page: Page) {
  const bodies: unknown[] = [];
  await page.route('**/api/scheduling/bookings/**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return bodies;
}

for (const vp of WIDTHS) {
  test(`HC-022 — out-of-hours bookings stay inside the track at ${vp.id}`, async ({ page }) => {
    await openCalendar(page, vp.width, vp.height);
    const pre = eventBox(page, 'Paciente PreWindow');
    const post = eventBox(page, 'Paciente PostWindow');
    await pre.scrollIntoViewIfNeeded();
    const clip = pre.locator('xpath=ancestor::*[contains(@class,"track-clip")]');
    await expect(clip).toHaveCount(1);
    const c = await rect(clip);
    const p = await rect(pre);
    // Bounded hitbox: the painted box IS the hit area, and it lies in the track.
    expect(p.top).toBeGreaterThanOrEqual(c.top - 0.5);
    expect(p.height).toBeLessThan(40); // 20 visible minutes, not the 80 it lasts
    // Continuation affordance, visible and announced.
    const topMark = pre.locator('.evt-clip.is-top');
    await expect(topMark).toBeVisible();
    await expect(topMark).toHaveText('Starts 06:00');
    expect(await pre.getAttribute('aria-describedby')).toContain('clip-');

    await page.locator('.cal-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight));
    const q = await rect(post);
    const c2 = await rect(clip);
    expect(q.bottom).toBeLessThanOrEqual(c2.bottom + 0.5);
    await expect(post.locator('.evt-clip.is-bottom')).toHaveText('Ends 22:30');

    // The clip did not disturb the sticky tiers: after scrolling the time axis
    // the column head is still pinned to the scroller's top edge.
    const scroller = await rect(page.locator('.cal-scroll'));
    const head = await rect(page.locator('.col-head').first());
    expect(Math.abs(head.top - scroller.top)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath(`hc022-${vp.id}.png`) });
  });
}

test('HC-022 — a drag ghost at the track edge is not clipped (1280)', async ({ page }) => {
  await openCalendar(page, 1280, 800);
  const bodies = await stubPatch(page);
  const pre = eventBox(page, 'Paciente PreWindow');
  await pre.scrollIntoViewIfNeeded();
  // Resize the clipped box from its bottom handle: the ghost is drawn from the
  // booking's TRUE start (06:00, above the track) to the new end — it lives in
  // the unclipped overlay, so the part above the track is still painted.
  const handle = pre.locator('.evt-resize');
  const box = await handle.boundingBox();
  if (!box) throw new Error('no handle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y - (14 * i) / 6);
  const ghost = page.locator('.evt-ghost');
  await expect(ghost).toBeVisible();
  await expect(ghost).toHaveText('06:00 – 07:00');
  const g = await rect(ghost);
  const track = await rect(page.locator('.col:not(.is-all) .track').last());
  expect(g.top).toBeLessThan(track.top - 40); // the 06:00 hour sits above the track…
  expect(g.height).toBeGreaterThanOrEqual(55); // …at its full 60-minute height
  await expect(ghost.locator('xpath=ancestor::*[contains(@class,"track-overlay")]')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('hc022-ghost.png') });
  await page.mouse.up();
  await expect.poll(() => bodies.length).toBe(1);
});

test.describe('HC-023 — coarse pointer', () => {
  test.use({ hasTouch: true });
  test('a truncated column head opens its full name on tap and on Tab at 390', async ({ page }) => {
    await openCalendar(page, 390, 844);
    const long = 'Nikolas Sebastian Pinon Sarria';
    const head = page.locator('.col-head .head-name', { hasText: long });
    await head.scrollIntoViewIfNeeded();
    expect(await page.locator('.col-head[title]').count()).toBe(0);
    expect(await head.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(head).toHaveAttribute('tabindex', '0');

    // Tap: the panel opens with the full text; a second tap closes it.
    await head.tap();
    const panel = page.locator('[data-scope="tooltip"][data-part="content"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveText(long);
    await page.screenshot({ path: test.info().outputPath('hc023-tap.png') });
    await head.tap();
    await expect(panel).toHaveCount(0);

    // Keyboard: Shift+Tab away then Tab back lands on the head with keyboard
    // focus, which opens it; Escape closes.
    await head.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(head).toBeFocused();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // An untruncated head is not a tooltip trigger at all (no noise).
    const short = page.locator('.col-head .head-name', { hasText: 'Leiva' });
    expect(await short.getAttribute('data-scope')).toBeNull();
  });

  test('board column heads carry no native title and are focusable', async ({ page }) => {
    await openCalendar(page, 390, 844, '?view=board');
    const titles = page.locator('.btitle');
    await expect(titles.first()).toBeVisible();
    expect(await page.locator('.bhead [title]').count()).toBe(0);
    for (const t of await titles.all()) await expect(t).toHaveAttribute('tabindex', '0');
  });
});

test('HC-016 — Calendar → Table → Calendar → Board → Calendar keeps the runway anchor (1280)', async ({
  page,
}) => {
  await openCalendar(page, 1280, 800, '?view=week');
  const scroller = page.locator('.cal-scroll');
  await expect(scroller).toHaveClass(/is-runway/);
  const colW = await page
    .locator('.col')
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);

  /** Label of the first VISIBLE column (the one flush with the gutter). */
  const firstVisible = () =>
    page.evaluate(() => {
      const sc = document.querySelector('.cal-scroll')!.getBoundingClientRect();
      const gutter = 52;
      const cols = [...document.querySelectorAll('.col')];
      const first = cols
        .map((c) => ({ c, d: Math.abs(c.getBoundingClientRect().left - (sc.left + gutter)) }))
        .sort((a, b) => a.d - b.d)[0].c;
      return first.querySelector('.head-sub')?.textContent?.trim() ?? '';
    });
  const calendarRequests = () =>
    page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter((e) => e.name.includes('/api/scheduling/calendar')).length,
    );

  // Settle on a distant, mid-week day with the time axis scrolled.
  const monday = await firstVisible();
  // One column on: Tuesday (the visit's day) becomes the first visible column.
  await scroller.evaluate((el, dx) => el.scrollBy({ left: dx, behavior: 'instant' }), colW);
  await scroller.evaluate((el) => (el.scrollTop = 120));
  await page.waitForTimeout(400); // past the settle debounce either way
  const dayBefore = await firstVisible();
  expect(dayBefore).not.toBe(monday); // Tuesday, one column on
  const topBefore = await scroller.evaluate((el) => el.scrollTop);
  expect(topBefore).toBe(120);
  // Fan a visit out: documented contract — it closes on any view switch.
  const visit = page.locator('.evt.is-visit');
  await visit.click();
  await expect(page.locator('.fan-deck')).toBeVisible();
  const requestsBefore = await calendarRequests();

  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(page.locator('.cal-root')).toHaveCount(0);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(scroller).toHaveClass(/is-runway/);
  await expect.poll(firstVisible).toBe(dayBefore);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(topBefore);
  await expect(page.locator('.fan-deck')).toHaveCount(0);

  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.cal-root')).toHaveCount(0);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(scroller).toHaveClass(/is-runway/);
  await expect.poll(firstVisible).toBe(dayBefore);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(topBefore);
  expect(await calendarRequests()).toBe(requestsBefore); // no extra fetch
  await page.screenshot({ path: test.info().outputPath('hc016-after-roundtrip.png') });
});

test('HC-021 — month: hover card + "Open day", refusal hint on a drag attempt (768)', async ({
  page,
}) => {
  // Martin's chair only: his three bookings fit the cell's chip budget, so
  // the visit chip is on screen rather than folded into "+N more".
  await openCalendar(page, 768, 1024, '?view=month&staff=r2');
  const bodies = await stubPatch(page);
  const chip = page.locator('.m-chip.is-visit');
  await expect(chip).toBeVisible();
  await expect(chip.locator('.m-chip-c')).toHaveText('×2');

  // Hover/focus detail: the same visit card as the week box, plus the jump.
  await chip.hover();
  const card = page.locator('[data-scope="tooltip"][data-part="content"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 services');
  await page.screenshot({ path: test.info().outputPath('hc021-card.png') });
  await card.getByRole('button', { name: 'Open day', exact: true }).click();
  let intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  let url = new URL(intents.at(-1)!, MOBILE_FIXTURE_URL);
  expect(url.searchParams.get('view')).toBe('day');
  expect(url.searchParams.get('date')).toBe('2026-09-08');

  // Back to month; a drag attempt on a chip commits nothing and shows the way.
  await openCalendar(page, 768, 1024, '?view=month&staff=r2');
  const box = await page.locator('.m-chip.is-visit').boundingBox();
  if (!box) throw new Error('no chip');
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(box.x + 10, box.y + box.height / 2 + 4 * i);
  const hint = page.locator('.m-hint');
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Open the day to move');
  await page.screenshot({ path: test.info().outputPath('hc021-hint.png') });
  await page.mouse.up();
  expect(bodies).toEqual([]);
  await hint.click();
  intents = await page.evaluate(() => Reflect.get(window, '__fixtureNav') as string[]);
  url = new URL(intents.at(-1)!, MOBILE_FIXTURE_URL);
  expect(url.searchParams.get('view')).toBe('day');
  expect(url.searchParams.get('date')).toBe('2026-09-08');
});
