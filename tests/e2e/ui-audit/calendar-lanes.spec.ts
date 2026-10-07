/**
 * S3 — stable facet registry + category (HC-017, HC-018, HC-020) in real
 * Chromium on the isolated mobile-composition fixture (see mobile-fixture.ts
 * for how to run it). Lane GEOMETRY lives here: happy-dom lays nothing out, so
 * `booking-calendar-lanes.mounted.test.ts` proves the lane list and this spec
 * proves the pixels.
 *
 * The fixture has no server. The week cache's `/api/scheduling/calendar`
 * reads are answered by `page.route()` below: every week is empty except
 * FIXTURE week + 1, whose payload is held behind a gate the test releases
 * once it has measured the lanes — that is the "a new week loads with a new
 * facet while the operator is looking" moment HC-018 is about.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { test, MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT } from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

const WIDTHS = [
  { id: 'compact-390', width: 390, height: 844 },
  { id: 'medium-portrait', width: 768, height: 1024 },
  { id: 'wide-1280', width: 1280, height: 800 },
] as const;

/** FIXTURE_DAY is Tue 2026-09-08. The page seeds `calendarLoadDays` — the
 *  Monday before through three weeks after (08-31 … 09-27) — so the first week
 *  the cache FETCHES when the operator pages forward is the fourth one. */
const WEEK_B_MONDAY = '2026-09-28';
/** Column heads of that week (`.head-name` + `.head-sub`). */
const WEEK_B_DAYS = [
  'Mon Sep 28',
  'Tue Sep 29',
  'Wed Sep 30',
  'Thu Oct 1',
  'Fri Oct 2',
  'Sat Oct 3',
  'Sun Oct 4',
];

async function openWeek(page: Page, width: number, height: number, subBy: string) {
  await page.addInitScript((v: string) => {
    localStorage.setItem('hub-scheduling-calendar-subcolumns', v);
  }, subBy);
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/calendar.html?view=week`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
  await expect(page.locator('.head-subs').first()).toBeVisible();
}

interface Lane {
  label: string;
  left: number;
  width: number;
}
interface ColumnLanes {
  day: string;
  lanes: Lane[];
}

/** Lane boxes of every rendered column, plus the day under the gutter. */
async function laneMap(page: Page): Promise<{ firstDay: string; columns: ColumnLanes[] }> {
  return page.evaluate(() => {
    const scroller = document.querySelector('.cal-scroll') as HTMLElement;
    const gutter = parseFloat(getComputedStyle(scroller).getPropertyValue('--cal-gutter')) || 0;
    const edge = scroller.getBoundingClientRect().left + gutter;
    const round = (n: number) => Math.round(n * 10) / 10;
    const columns = [...document.querySelectorAll<HTMLElement>('.col')]
      .map((col) => ({
        left: col.getBoundingClientRect().left,
        day: `${col.querySelector('.head-name')?.textContent ?? ''} ${
          col.querySelector('.head-sub')?.textContent ?? ''
        }`.trim(),
        lanes: [...col.querySelectorAll<HTMLElement>('.head-sub-cell')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.textContent ?? '').trim(),
            left: round(r.left),
            width: round(r.width),
          };
        }),
      }))
      .sort((a, b) => a.left - b.left);
    const first = columns.find((c) => c.left >= edge - 1) ?? columns[0];
    return {
      firstDay: first?.day ?? '',
      columns: columns.map(({ day, lanes }) => ({ day, lanes })),
    };
  });
}

/** Stub the week reads: empty everywhere, week B held behind `release`. */
async function stubWeeks(page: Page, weekB: { bookings: unknown[]; tagOptions: unknown[] }) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/scheduling/calendar?**', async (route) => {
    const from = new URL(route.request().url()).searchParams.get('from') ?? '';
    const held = from === WEEK_B_MONDAY;
    if (held) await gate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calendarScope: JSON.stringify(['fixture-org', 'America/Lima']),
        ...(held ? weekB : { bookings: [], tagOptions: [] }),
      }),
    });
  });
  return release;
}

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

for (const viewport of WIDTHS) {
  test.describe(viewport.id, () => {
    test('HC-018: a later week adding a facet appends a lane; existing lanes keep order, width and the first visible day', async ({
      page,
    }) => {
      const release = await stubWeeks(page, {
        bookings: [
          {
            id: 'wb-pending',
            resourceId: 'r1',
            eventTypeId: 'et0',
            start: '2026-09-29T14:00:00.000Z',
            end: '2026-09-29T14:45:00.000Z',
            status: 'pending',
            attendeeName: 'Paciente Semana B',
            tags: [],
            kindId: 'k1',
            category: null,
            categoryColor: null,
          },
        ],
        tagOptions: [],
      });
      await openWeek(page, viewport.width, viewport.height, 'status');
      // Seed week: accepted + one completed booking → two lanes.
      const seeded = await laneMap(page);
      expect(seeded.columns[0].lanes.map((l) => l.label)).toEqual(['Confirmed', 'Completed']);

      // Page forward to the first week the cache has to FETCH; its payload is
      // held, so the operator is looking at the two lanes the session already
      // showed (nothing re-derived them away while the week was empty).
      // "Next" pages by one SCREEN (fewer days than a week once lanes narrow
      // the columns), so page until the gutter day is inside week B.
      for (let i = 0; i < 12 && !WEEK_B_DAYS.includes((await laneMap(page)).firstDay); i++) {
        const was = (await laneMap(page)).firstDay;
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await expect
          .poll(async () => (await laneMap(page)).firstDay, { timeout: 5000 })
          .not.toBe(was);
        await page.waitForTimeout(200);
      }
      const before = await laneMap(page);
      expect(WEEK_B_DAYS).toContain(before.firstDay);
      expect(before.columns[0].lanes.map((l) => l.label)).toEqual(['Confirmed', 'Completed']);

      release();
      await expect
        .poll(async () => (await laneMap(page)).columns[0].lanes.map((l) => l.label), {
          timeout: 5000,
        })
        .toEqual(['Confirmed', 'Completed', 'Pending']);
      const after = await laneMap(page);

      // `pending` ranks between the two in the registry; the session appends it.
      // Every column keeps its existing lanes' order and pixel width, and the
      // day under the gutter did not jump.
      expect(after.firstDay).toBe(before.firstDay);
      const widthsBefore = new Set(before.columns.flatMap((c) => c.lanes.map((l) => l.width)));
      expect(widthsBefore.size).toBe(1);
      const [laneW] = [...widthsBefore];
      for (const col of after.columns) {
        expect(col.lanes.map((l) => l.label)).toEqual(['Confirmed', 'Completed', 'Pending']);
        for (const lane of col.lanes) expect(Math.abs(lane.width - laneW)).toBeLessThanOrEqual(1);
      }
      test.info().annotations.push({
        type: 'lanes',
        description: JSON.stringify({ before: before.columns[0], after: after.columns[0] }),
      });
    });

    test('HC-017: a two-tag booking sits in both tag lanes as one record (one PATCH per drag)', async ({
      page,
    }) => {
      await stubWeeks(page, { bookings: [], tagOptions: [] });
      const bodies: Record<string, unknown>[] = [];
      await page.route('**/api/scheduling/bookings/**', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        bodies.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, booking: { id: 'r3-two-tags' } }),
        });
      });
      await openWeek(page, viewport.width, viewport.height, 'tags');
      const lanes = (await laneMap(page)).columns[0].lanes.map((l) => l.label);
      expect(lanes).toEqual(['VIP', 'VIP Cliente']);

      const copies = page.locator('.evt[data-booking-id="r3-two-tags"]');
      await expect(copies).toHaveCount(2);
      expect(
        await copies.evaluateAll((els) => els.map((el) => el.getAttribute('data-sub')).sort()),
      ).toEqual(['0', '1']);
      // The contact-tag-only booking renders once, in the second lane.
      await expect(page.locator('.evt[data-booking-id="r4-contact-tag"]')).toHaveAttribute(
        'data-sub',
        '1',
      );

      // Dragging the SECOND copy moves the one booking: exactly one PATCH.
      await dragBy(page, copies.nth(1).locator('.evt-in'), 40);
      await expect.poll(() => bodies.length, { timeout: 5000 }).toBe(1);
      expect(bodies[0]).toMatchObject({ start: expect.any(String), end: expect.any(String) });
      await expect.poll(() => bodies.length, { timeout: 1500 }).toBe(1);
    });

    test('HC-020: category lanes are named from the registry, in registry order, Unclassified last', async ({
      page,
    }) => {
      await stubWeeks(page, { bookings: [], tagOptions: [] });
      await openWeek(page, viewport.width, viewport.height, 'category');
      const lanes = (await laneMap(page)).columns[0].lanes.map((l) => l.label);
      expect(lanes).toEqual(['Laser', 'Facial', 'Unclassified']);
      await expect(page.locator('.evt[data-booking-id="r3-two-tags"]')).toHaveAttribute(
        'data-sub',
        '0',
      );
      await expect(page.locator('.evt[data-booking-id="r1-1"]')).toHaveAttribute('data-sub', '1');
      await expect(page.locator('.evt[data-booking-id="r1-0"]')).toHaveAttribute('data-sub', '2');
    });
  });
}
