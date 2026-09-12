/**
 * UI-04 follow-up (S9) — calendar rendering + interaction e2e: move, resize,
 * 409-revert, cancel-revert and tag-visual coverage at 390/768/1280, on the
 * same isolated fixture as calendar-mobile.spec.ts (see mobile-fixture.ts for
 * how to run this). The fixture has no server, so every PATCH/PUT the
 * component issues is intercepted with `page.route()` below — the fixture's
 * own network-isolation fixture (`fixtureNetwork`) would otherwise 404 or
 * abort them.
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
  await expect(page.locator('.cal-body .ec')).toBeVisible();
}

function eventChip(page: Page, attendeeName: string): Locator {
  return page.locator('.ec-event').filter({ hasText: attendeeName });
}

async function slotHeightPx(page: Page): Promise<number> {
  const raw = await page
    .locator('.ec-main')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--ec-slot-height'));
  const px = parseFloat(raw);
  if (!px) throw new Error(`Unreadable --ec-slot-height: "${raw}"`);
  return px; // px per 15-minute slot (slotDuration: '00:15').
}

async function insetBlockStart(chip: Locator): Promise<number> {
  return chip.evaluate((el) => parseFloat((el as HTMLElement).style.insetBlockStart) || 0);
}

async function blockSize(chip: Locator): Promise<number> {
  return chip.evaluate((el) => parseFloat((el as HTMLElement).style.blockSize) || 0);
}

/** Drag the chip's center down by `deltaY` px (a real pointer sequence, not a synthetic drop). */
async function dragChip(page: Page, chip: Locator, deltaY: number) {
  await chip.scrollIntoViewIfNeeded();
  const box = await chip.boundingBox();
  if (!box) throw new Error('Chip has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (deltaY * i) / 8);
  await page.mouse.up();
}

/** Drag the chip's bottom resize handle down by `deltaY` px. */
async function resizeChipBottom(page: Page, chip: Locator, deltaY: number) {
  const handle = chip.locator('.ec-resizer');
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('Resize handle has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + (deltaY * i) / 6);
  await page.mouse.up();
}

/** Stub the reschedule PATCH the dialog's Save button issues. */
async function stubBookingPatch(page: Page, status: 200 | 409) {
  await page.route('**/api/scheduling/bookings/**', async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    if (status === 409) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'conflict' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, booking: { id: route.request().url().split('/').pop() } }),
    });
  });
}

async function stubPreferencesPut(page: Page) {
  await page.route('**/api/me/preferences/calendar', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

const moveDialog = (page: Page) => page.getByRole('dialog', { name: 'Confirm reschedule' });

for (const viewport of WIDTHS) {
  test.describe(`at ${viewport.id}`, () => {
    test('every fixture event renders, own-tag colour and contact-tag origin dot are visible', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height);

      const ownTagChip = eventChip(page, 'Paciente 1A');
      await expect(ownTagChip).toBeVisible();
      const bg = await ownTagChip.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe('rgb(247, 210, 79)'); // #f7d24f, the event's own VIP tag colour.

      const contactChip = eventChip(page, 'Paciente ContactTag');
      await expect(contactChip).toBeVisible();
      await expect(contactChip.locator('.ec-chip-tag[data-origin="contact"]')).toHaveCount(1);

      const preWindowChip = eventChip(page, 'Paciente PreWindow');
      await expect(preWindowChip).toBeVisible();
      // Clipped to the grid's 07:00 floor (slotMinTime) — chunk.start == grid start.
      expect(await insetBlockStart(preWindowChip)).toBe(0);
    });

    test('toggle: "Show linked tags" hides and restores contact-origin dots only', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height);
      await stubPreferencesPut(page);

      const contactDot = eventChip(page, 'Paciente ContactTag').locator(
        '.ec-chip-tag[data-origin="contact"]',
      );
      const ownDot = eventChip(page, 'Paciente 1A').locator('.ec-chip-tag[data-origin="own"]');
      await expect(contactDot).toHaveCount(1);
      await expect(ownDot).toHaveCount(1);

      const toggle = page.getByRole('switch', { name: 'Show linked tags' });
      await toggle.click();
      await expect(contactDot).toHaveCount(0);
      await expect(ownDot).toHaveCount(1); // own tags never hide.

      await toggle.click();
      await expect(contactDot).toHaveCount(1);
    });

    test('move: dragging a chip opens the confirm dialog with the new time and relocates it', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r5');
      await stubBookingPatch(page, 200);

      const chip = eventChip(page, 'Paciente Overlap A');
      const slot = await slotHeightPx(page);
      const oldTop = await insetBlockStart(chip);
      await dragChip(page, chip, slot * 4); // +60 min (4 * 15-min slots).

      const dialog = moveDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('07:00 PM');

      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      await expect(chip).toContainText('07:00 PM');
      const newTop = await insetBlockStart(chip);
      expect(newTop - oldTop).toBeCloseTo(slot * 4, 0);
    });

    test('resize: dragging the bottom handle grows the chip and shows the new end time', async ({
      page,
    }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r4');
      await stubBookingPatch(page, 200);

      const chip = eventChip(page, 'Paciente ContactTag'); // 16:00-16:45
      const slot = await slotHeightPx(page);
      const oldHeight = await blockSize(chip);
      await resizeChipBottom(page, chip, slot);

      const dialog = moveDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('05:00 PM'); // 16:45 + 15 min.

      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();
      const newHeight = await blockSize(chip);
      expect(newHeight - oldHeight).toBeCloseTo(slot, 0);
    });

    test('409 revert: a rejected reschedule toasts and snaps the chip back', async ({ page }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r5');
      await stubBookingPatch(page, 409);

      const chip = eventChip(page, 'Paciente Overlap A');
      const oldTop = await insetBlockStart(chip);
      const slot = await slotHeightPx(page);
      await dragChip(page, chip, slot * 2); // onto Overlap B's span.

      const dialog = moveDialog(page);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).toBeHidden();

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
        .toBe('That slot is taken');
      expect(await insetBlockStart(chip)).toBe(oldTop);
    });

    test('cancel revert: dismissing the move dialog snaps the chip back', async ({ page }) => {
      await openCalendar(page, viewport.width, viewport.height, '?staff=r1');
      await stubBookingPatch(page, 200);

      const chip = eventChip(page, 'Paciente 1A');
      const oldTop = await insetBlockStart(chip);
      const slot = await slotHeightPx(page);
      await dragChip(page, chip, slot * 2);

      const dialog = moveDialog(page);
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      expect(await insetBlockStart(chip)).toBe(oldTop);
    });
  });
}
