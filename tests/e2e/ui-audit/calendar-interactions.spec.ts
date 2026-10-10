/**
 * UI-04 follow-up — calendar rendering + interaction e2e: move, resize,
 * 409-conflict, error-revert and tag-visual coverage at 390/768/1280, on the
 * same isolated fixture as calendar-mobile.spec.ts (see mobile-fixture.ts for
 * how to run this). The fixture has no server, so every PATCH/PUT the
 * component issues is intercepted with `page.route()` below — the fixture's own
 * network-isolation fixture (`fixtureNetwork`) would otherwise 404 or abort them.
 *
 * Ported to `BookingCalendar` (spec 2026-09-27 S3), which replaced
 * `@event-calendar/core` on `/scheduling/calendar`. Two mechanics changed, so
 * the scenarios are expressed differently while covering the same behaviour:
 *
 * 1. A drag COMMITS — there is no "confirm reschedule" dialog any more. The box
 *    paints the new window optimistically, the PATCH goes out, and the overlay
 *    is retired once the round trip resolves. The fixture's `invalidate` is a
 *    no-op, so the box returns to its seeded slot afterwards; these specs
 *    therefore assert the in-flight paint (the stub holds the response open)
 *    plus the request the component actually issued.
 * 2. A refused move (409 with `conflicts`) opens the calendar's own conflict
 *    dialog instead of a toast, and leaves the box where it was.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { test, MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT } from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

const WIDTHS = [
  { id: 'compact-390', width: 390, height: 844 },
  { id: 'medium-portrait', width: 768, height: 1024 },
  { id: 'wide-1280', width: 1280, height: 800 },
] as const;

/** How long the stubbed PATCH is held open, so the optimistic paint is observable. */
const HOLD_MS = 1200;

async function openCalendar(page: Page, width: number, height: number, query = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html${query}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
  await expect(page.locator('.evt').first()).toBeVisible();
}

/**
 * The box in a RESOURCE column. Day view also draws an aggregate "All" column
 * first, so every booking renders twice — the resource column is the one that
 * carries the drag/merge semantics under test.
 */
function eventBox(page: Page, attendeeName: string): Locator {
  return page.locator('.col:not(.is-all) .evt').filter({ hasText: attendeeName });
}

/** px per 15-minute slot, derived from the track's own height (07:00–21:00). */
async function slotHeightPx(page: Page): Promise<number> {
  const height = await page
    .locator('.col:not(.is-all) .track')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  // 07:00..21:00 renders FIFTEEN hour rows (`endHour` keeps a full row of its
  // own — `TRACK_H` in BookingCalendar), four 15-minute snaps each.
  const px = height / 15 / 4;
  if (!px) throw new Error(`Unreadable track height: ${height}`);
  return px;
}

/** The grid positions every box with inline `top`/`height` in px. */
async function boxTop(box: Locator): Promise<number> {
  return box.evaluate((el) => parseFloat((el as HTMLElement).style.top) || 0);
}

async function boxHeight(box: Locator): Promise<number> {
  return box.evaluate((el) => parseFloat((el as HTMLElement).style.height) || 0);
}

/** Drag from `handle`'s centre down by `deltaY` px (a real pointer sequence). */
async function dragBy(page: Page, handle: Locator, deltaY: number, steps = 8) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Drag handle has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x, y + (deltaY * i) / steps);
  await page.mouse.up();
}

interface PatchLog {
  bodies: Record<string, unknown>[];
}

/**
 * Stub the reschedule PATCH the drag issues, holding the response open for
 * `HOLD_MS` so the optimistic paint can be observed, and recording every body.
 */
async function stubBookingPatch(
  page: Page,
  outcome: 'ok' | 'conflict' | 'error',
  hold = HOLD_MS,
): Promise<PatchLog> {
  const log: PatchLog = { bodies: [] };
  await page.route('**/api/scheduling/bookings/**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    log.bodies.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    await new Promise((resolve) => setTimeout(resolve, hold));
    if (outcome === 'conflict') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'conflict',
          conflicts: [
            {
              id: 'r5-overlap-b',
              title: 'Consulta inicial',
              start: new Date('2026-09-08T23:20:00.000Z').toISOString(),
              end: new Date('2026-09-09T00:05:00.000Z').toISOString(),
              resourceId: 'r5',
            },
          ],
        }),
      });
      return;
    }
    if (outcome === 'error') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, booking: { id: route.request().url().split('/').pop() } }),
    });
  });
  return log;
}

async function stubPreferencesPut(page: Page) {
  await page.route('**/api/me/preferences/calendar', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** Colour the box background by TAGS instead of the default `status` source —
 *  a per-viewer preference, so it is seeded in localStorage before the mount. */
async function colorByTags(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('hub-scheduling-calendar-color-block', 'tags');
    localStorage.setItem('hub-scheduling-calendar-color-sliver', 'tags');
  });
}

const conflictDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'That time is already booked' });

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.id}`, () => {
    test('every fixture booking renders, own-tag colour paints the block and a contact-tag dot shows its origin', async ({
      page,
    }) => {
      await colorByTags(page);
      await openCalendar(page, viewport.width, viewport.height);

      const ownTagBox = eventBox(page, 'Paciente 1A');
      await expect(ownTagBox).toBeVisible();
      // `--evt-c` is the resolved colour source the block tints itself from.
      const blockColor = await ownTagBox.evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--evt-c').trim(),
      );
      expect(blockColor).toBe('#f7d24f'); // the booking's own VIP tag colour.

      const contactBox = eventBox(page, 'Paciente ContactTag');
      await expect(contactBox).toBeVisible();
      // Inherited-from-the-client tags carry the ringed dot shape.
      await expect(contactBox.locator('.evt-tags .tag-dot.contact')).toHaveCount(1);

      // A booking that starts before the grid's 07:00 floor still RENDERS, but
      // the shared grid does not clip it the way the retired renderer did: it
      // positions it at a negative offset (06:00 = one `pxPerHour` above the
      // track origin) and relies on the opaque sticky column head to cover the
      // overhang. Pinned as-is, with the clipping tracked as an open end —
      // ledger §43, proposals/2026-09-25-hub-pos-calendar-color-followups.md.
      const preWindowBox = eventBox(page, 'Paciente PreWindow');
      await expect(preWindowBox).toBeVisible();
      expect(await boxTop(preWindowBox)).toBeLessThan(0);
      expect(await boxTop(preWindowBox)).toBeCloseTo(-(await slotHeightPx(page)) * 4, 0);
    });

    test('toggle: "Show linked tags" hides and restores contact-origin dots only', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height);
      await stubPreferencesPut(page);

      const contactDot = eventBox(page, 'Paciente ContactTag').locator(
        '.evt-tags .tag-dot.contact',
      );
      const ownDot = eventBox(page, 'Paciente 1A').locator(
        '.evt-tags .tag-dot:not(.contact):not(.product)',
      );
      await expect(contactDot).toHaveCount(1);
      await expect(ownDot).toHaveCount(1);

      const toggle = page.getByRole('switch', { name: 'Show linked tags' });
      await toggle.click();
      await expect(contactDot).toHaveCount(0);
      await expect(ownDot).toHaveCount(1); // own tags never hide.

      await toggle.click();
      await expect(contactDot).toHaveCount(1);
    });

    test('move: dragging a box paints the new window and PATCHes the new start', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r5');
      const log = await stubBookingPatch(page, 'ok');

      const box = eventBox(page, 'Paciente Overlap A'); // 18:00–18:45
      const slot = await slotHeightPx(page);
      const oldTop = await boxTop(box);
      await dragBy(page, box.locator('.evt-in'), slot * 4); // +60 min.

      // The optimistic overlay is on screen while the PATCH is in flight.
      await expect.poll(() => boxTop(box)).toBeCloseTo(oldTop + slot * 4, 0);
      await expect(box).toContainText('19:00');

      // …and the request carries the moved window, not the original one.
      await expect.poll(() => log.bodies.length).toBe(1);
      const body = log.bodies[0] as { start: string; end: string; resourceId: string };
      expect(new Date(body.start).getHours()).toBe(19);
      expect(new Date(body.end).getHours()).toBe(19);
      expect(body.resourceId).toBe('r5');
    });

    test('view-only axis (HC-014): a drag across kind lanes is refused before a misleading ghost; the PATCH carries only the time', async ({
      page,
    }) => {
      // The subcolumn axis is a per-viewer preference, seeded before the mount.
      await page.addInitScript(() => {
        localStorage.setItem('hub-scheduling-calendar-subcolumns', 'kind');
      });
      await openCalendar(page, viewport.width, viewport.height, '?staff=r1');
      const log = await stubBookingPatch(page, 'ok');

      const box = eventBox(page, 'Paciente 1A'); // kind k1 → lane 0; r1-1 is k2 → lane 1
      const col = page.locator('.col:not(.is-all)').first();
      const heads = col.locator('.head-sub-cell');
      await expect(heads).toHaveCount(2);
      await expect(heads.first()).toContainText('view only');
      const sourceLane = await box.getAttribute('data-lane');
      const slot = await slotHeightPx(page);

      // Press on the box, cross into the OTHER lane one hour lower, hold.
      const handle = box.locator('.evt-in');
      const hb = (await handle.boundingBox())!;
      const cb = (await col.boundingBox())!;
      const targetX = cb.x + cb.width * (sourceLane === '0' ? 0.75 : 0.25);
      const y0 = hb.y + hb.height / 2;
      await page.mouse.move(hb.x + hb.width / 2, y0);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++)
        await page.mouse.move(hb.x + (targetX - hb.x) * (i / 8), y0 + (slot * 4 * i) / 8);

      // The ghost stays in the source lane, says why, and the lane refuses.
      const ghost = col.locator('.evt-ghost');
      await expect(ghost).toBeVisible();
      await expect(ghost).toHaveAttribute('data-lane', sourceLane!);
      await expect(ghost).toHaveClass(/is-refused/);
      await expect(ghost).toContainText('View only');
      await expect(heads.nth(sourceLane === '0' ? 1 : 0)).toHaveClass(/is-refused/);
      await expect(col).toHaveClass(/is-refusing/);
      await expect(col).toHaveCSS('cursor', 'not-allowed');
      await page.mouse.up();

      // One PATCH: the time moved, nothing reclassified, no property write.
      await expect.poll(() => log.bodies.length).toBe(1);
      expect(Object.keys(log.bodies[0]).sort()).toEqual(['end', 'resourceId', 'start']);
      expect(new Date(log.bodies[0].start as string).getHours()).toBe(9);
      await expect(box).toHaveAttribute('data-lane', sourceLane!);
      await expect(col.locator('.is-refused')).toHaveCount(0);
    });

    test('resize: dragging the bottom handle grows the box and PATCHes the later end', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r4');
      const log = await stubBookingPatch(page, 'ok');

      const box = eventBox(page, 'Paciente ContactTag'); // 16:00–16:45
      const slot = await slotHeightPx(page);
      const oldHeight = await boxHeight(box);
      await dragBy(page, box.locator('.evt-resize'), slot, 6);

      await expect.poll(() => boxHeight(box)).toBeCloseTo(oldHeight + slot, 0);

      await expect.poll(() => log.bodies.length).toBe(1);
      const body = log.bodies[0] as { start: string; end: string };
      expect(new Date(body.start).getHours()).toBe(16);
      expect(new Date(body.end).getHours()).toBe(17); // 16:45 + 15 min.
    });

    test('409 revert: a refused reschedule opens the conflict dialog and leaves the box in place', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r5');
      await stubBookingPatch(page, 'conflict', 100);

      const box = eventBox(page, 'Paciente Overlap A');
      const oldTop = await boxTop(box);
      const slot = await slotHeightPx(page);
      await dragBy(page, box.locator('.evt-in'), slot * 2); // onto Overlap B's span.

      const dialog = conflictDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Moving this appointment would overlap');

      // "Pick another time" dismisses it, and the box never left its slot.
      await dialog.getByRole('button', { name: 'Pick another time' }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => boxTop(box)).toBe(oldTop);
    });

    test('error revert: a failed reschedule toasts and snaps the box back', async ({ page }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r1');
      await stubBookingPatch(page, 'error', 100);

      const box = eventBox(page, 'Paciente 1A');
      const oldTop = await boxTop(box);
      const slot = await slotHeightPx(page);
      await dragBy(page, box.locator('.evt-in'), slot * 2);

      // The fixture doesn't mount `<Toaster>` (see CalendarFixture.svelte) —
      // it exposes the same store `toastError` writes into instead.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as { __toaster: { getVisibleToasts(): { title: string }[] } }
              ).__toaster.getVisibleToasts()[0]?.title,
          ),
        )
        .toBe('Could not move the appointment');
      await expect.poll(() => boxTop(box)).toBe(oldTop);
    });
  });
}
