/**
 * POS calendar — container status from active members, optimistic cancel,
 * and fan-deck drag-to-reorder / drag-out-to-separate (proposal
 * 2026-09-29-hub-pos-calendar-container-cancel-drag.md). Runs against the
 * seeded QA tenant (owner persona), like table-filters.spec.ts /
 * record-peek.spec.ts.
 *
 * Creates its own 3-member visit via the API (no seeded group fixture exists
 * yet) and best-effort cancels every member afterward — there is no DELETE
 * on `/api/pos/appointments/[id]`, so "delete after" here means "cancel",
 * which also frees the resource/time slot for the next run.
 *
 * TODO(handoff): the "drag outside separates" test occasionally times out
 * waiting for `data-drop="separate"` when it runs as the THIRD test in one
 * worker (reliable alone and in most full-file runs); instrumented debug
 * logging confirmed `onFanDragMove`'s outside-detection itself flips
 * correctly on `clientX`, so this reads as Playwright pointer-event timing
 * under a loaded dev server, not a defect in the shipped reactive logic —
 * unconfirmed against a fresh, idle QA stack. Also: the keyboard path
 * (`onFanBlockKey` — Alt+ArrowUp/Down reorder, Alt+Delete separate) has no
 * automated coverage here, only the pointer-drag paths. Ledger: meta-repo
 * `proposals/2026-09-29-hub-pos-calendar-container-cancel-drag.md`.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { matrixUuid, personaEmail, QA_PASSWORD } from '../../../scripts/qa/seed/ids';

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? personaEmail('tenancy.user.owner');
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? QA_PASSWORD;

test.skip(
  !process.env.E2E_BASE_URL && !process.env.E2E_UI_AUDIT,
  'Point E2E_BASE_URL at a running QA-stack dev server to run this spec.',
);

// RESOURCE_LIMA / these three event types are all assigned to it (America/Lima,
// Mon–Fri 09:00–18:00) — scripts/qa/seed/scheduling.ts.
const RESOURCE_LIMA = matrixUuid('sched.resource.staff-lima');
const EVENT_TYPE_PLAIN = matrixUuid('sched.event-type.plain'); // "QA Plain Event", 30 min
const EVENT_TYPE_PRIVATE = matrixUuid('sched.event-type.private'); // "QA Private Event", 30 min
const EVENT_TYPE_ROOM = matrixUuid('sched.event-type.room'); // "QA Room Event", 30 min

const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ?? '/tmp/claude-1000/pos-cal11-fan-drag-screenshots';

/** A Mon–Fri, `offsetDays` out — far enough that a fixed local start never
 *  races the clock the test happens to run at. */
function weekdayIso(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A random offset (not just a random hour): this suite's own PAST runs leave
// cancelled-but-still-rendered `.is-visit` leftovers on whatever day/hour
// they used, and a `force`-clicked box that overlaps one can hit whichever
// paints on top. A fresh day per invocation sidesteps every prior run's
// debris outright, rather than trying to out-schedule it.
const DAY = weekdayIso(2 + Math.floor(Math.random() * 90));
/** One slot per test (3h apart, 09:00/12:00/15:00 America/Lima) — accumulated
 *  leftovers from earlier interactive runs all sit at a single fixed slot, and
 *  a `force`-clicked box that overlaps a stale one can hit whichever renders
 *  on top; each test gets its own slot instead so nothing can overlap it. */
let slotIndex = 0;
function nextStart(): string {
  const hourUtc = 14 + slotIndex * 3;
  slotIndex += 1;
  return `${DAY}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`;
}

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(OWNER_EMAIL);
  await page.locator('#login-password').fill(OWNER_PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });
}

/** The container's own box (not a fan block) for our fixture visit. Day view
 *  also draws an aggregate "All" column, so every booking renders twice —
 *  the resource column is the one that carries the fan/drag semantics. */
function containerBox(page: Page, attendee: string): Locator {
  return page.locator('.col:not(.is-all) .evt.is-visit').filter({ hasText: attendee });
}

async function openFanDeck(page: Page, attendee: string): Promise<Locator> {
  await containerBox(page, attendee).click();
  const deck = page.locator('.fan-deck');
  await expect(deck).toBeVisible({ timeout: 10_000 });
  return deck;
}

/** Real pointer sequence — the component gates on a 4px move threshold before
 *  it treats a pointerdown as a drag. */
async function dragTo(page: Page, from: Locator, toY: number, toX?: number, steps = 10) {
  const box = await from.boundingBox();
  if (!box) throw new Error('drag source has no box');
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const x1 = toX ?? x0;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((toY - y0) * i) / steps);
  }
  return { x1, toY };
}

test.describe('POS calendar — fan-deck drag + container status', () => {
  let memberIds: string[] = [];
  // Unique per TEST (not just per file): a prior test's members are
  // CANCELLED, not deleted (no DELETE route exists — see afterEach), so they
  // keep rendering on the same DAY/resource/time under the same name — a
  // name shared across this file's own three tests collided with a sibling
  // test's leftover box and broke every strict-mode locator below.
  let attendee = '';

  test.beforeEach(async ({ page }, testInfo) => {
    attendee = `QA Fan Drag ${testInfo.testId} ${Date.now()}`;
    const start = nextStart();
    await login(page);

    // `page.request`, not the bare `request` fixture — it shares the page's
    // own cookies (the fresh fixture has none, and 401s).
    const res = await page.request.post('/api/pos/appointments', {
      data: {
        // The schema requires `eventTypeId` even on the group path (it's the
        // plain-booking field; unused once `eventTypeIds.length > 1`).
        eventTypeId: EVENT_TYPE_PLAIN,
        eventTypeIds: [EVENT_TYPE_PLAIN, EVENT_TYPE_PRIVATE, EVENT_TYPE_ROOM],
        start,
        resourceId: RESOURCE_LIMA,
        attendeeName: attendee,
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const created = (await res.json()) as { booking: { id: string }; members: number };
    expect(created.members).toBe(3);

    // The create response only names the lead — read the group back to get
    // every member id (needed for cleanup and for the reorder assertions).
    // Keyed on THIS visit's own groupId, not attendeeName: a previous run's
    // members are cancelled, not deleted (no DELETE route exists), and the
    // window still lists them under the same name.
    const win = await page.request.get(`/api/pos/appointments?from=${DAY}&to=${DAY}`);
    const payload = (await win.json()) as {
      bookings: Array<{
        id: string;
        attendeeName: string | null;
        groupId: string | null;
        groupSeq: number | null;
      }>;
    };
    const lead = payload.bookings.find((b) => b.id === created.booking.id);
    expect(lead?.groupId).toBeTruthy();
    memberIds = payload.bookings
      .filter((b) => b.groupId === lead!.groupId)
      .sort((a, b) => (a.groupSeq ?? 0) - (b.groupSeq ?? 0))
      .map((b) => b.id);
    expect(memberIds).toHaveLength(3);

    await page.goto(`/pos/appointments?date=${DAY}&view=day`, { waitUntil: 'networkidle' });
    await expect(page.locator('.cal-root .cal-scroll')).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    // Best-effort: no DELETE exists on this route, so "delete after" means
    // cancel every member this run created (also frees the slot for a rerun
    // on the same DAY).
    for (const id of memberIds) {
      await page.request
        .patch(`/api/pos/appointments/${id}`, { data: { status: 'cancelled' } })
        .catch(() => {});
    }
  });

  test('cancelling the lead keeps the container active with "1 cancelled", optimistically', async ({
    page,
  }) => {
    const deck = await openFanDeck(page, attendee);
    const leadBlock = deck.locator('.fan-evt').first();
    await expect(leadBlock).toContainText('QA Plain Event');

    // Hold the PATCH open so the optimistic paint is observable before the
    // server confirms it.
    let resolveHold!: () => void;
    const held = new Promise<void>((r) => (resolveHold = r));
    await page.route(`**/api/pos/appointments/${memberIds[0]}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await held;
      await route.continue();
    });

    // `.focus()` opens the interactive Zag tooltip far more reliably than a
    // synthetic `.hover()` alone in headless Chromium, but neither is 100% —
    // belt and suspenders, plus the machine's own 180ms openDelay.
    // `dispatchEvent('click')` instead of `.click()`: a real pointer click on
    // the portaled Cancel button moves the mouse there first, which blurs —
    // and closes — the trigger's tooltip before the click lands.
    await leadBlock.hover();
    await leadBlock.focus();
    const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
    await cancelBtn.dispatchEvent('click');

    // Optimistic: the fan block strikes through immediately, the PATCH is
    // still held.
    await expect(leadBlock).toHaveClass(/cancelled/, { timeout: 2_000 });

    // The container box itself never reads cancelled — it follows the first
    // ACTIVE member (seq 1, "QA Private Event") — and shows the "1 cancelled"
    // caption, all while the PATCH is still in flight.
    const container = containerBox(page, attendee);
    await expect(container).not.toHaveClass(/\bcancelled\b/);
    await expect(container.locator('.evt-cancelled')).toContainText('1 cancelled');

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/container-cancelled-lead-optimistic.png`,
      fullPage: false,
    });

    resolveHold();
    await expect
      .poll(async () =>
        (await page.request.get(`/api/pos/appointments/${memberIds[0]}`))
          .json()
          .then((d: { booking?: { status?: string } }) => d.booking?.status),
      )
      .toBe('cancelled');
  });

  test('dragging the last fan block to the top persists the new order after reload', async ({
    page,
  }) => {
    const deck = await openFanDeck(page, attendee);
    const blocks = deck.locator('.fan-evt');
    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(2)).toContainText('QA Room Event');

    const deckBox = await deck.boundingBox();
    if (!deckBox) throw new Error('deck has no box');

    await dragTo(page, blocks.nth(2), deckBox.y + 8);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/fan-deck-mid-drag.png` });
    await page.mouse.up();

    // The reorder POST landed — reload and re-open the deck to confirm the
    // NEW order survived a real page load, not just the in-memory preview.
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'networkidle' });
    const deck2 = await openFanDeck(page, attendee);
    await expect(deck2.locator('.fan-evt').first()).toContainText('QA Room Event');
  });

  test('dragging a fan block outside the deck separates it into its own box', async ({ page }) => {
    const deck = await openFanDeck(page, attendee);
    const blocks = deck.locator('.fan-evt');
    const last = blocks.nth(2);
    await expect(last).toContainText('QA Room Event');

    const deckBox = await deck.boundingBox();
    if (!deckBox) throw new Error('deck has no box');
    // Well past FAN_OUTSIDE_MARGIN (16px) to the LEFT of the deck — dragging
    // right instead risks overshooting the viewport's own right edge
    // (the deck opens `is-right`, already near the last day column).
    await dragTo(page, last, deckBox.y + deckBox.height / 2, deckBox.x - 120, 20);
    await expect(deck).toHaveAttribute('data-drop', 'separate', { timeout: 8_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/fan-deck-drop-outside-hint.png` });
    await page.mouse.up();

    // The visit shrank to 2 members — the deck (if still fanned) shows two
    // blocks, and the detached procedure now renders as its own box (once per
    // column: the aggregate "All" column, and its resource column).
    await expect(containerBox(page, attendee)).toHaveCount(1);
    await expect(
      page.locator('.col:not(.is-all) .evt:not(.is-visit)').filter({ hasText: 'QA Room Event' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
