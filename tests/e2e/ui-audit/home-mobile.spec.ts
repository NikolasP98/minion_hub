/**
 * UI-04 — Home composition at supported mobile widths.
 *
 * Red before the 13-02 repair (measured on the same fixture, 390x844):
 *   .column spanned 0..390 while the collapsed notes rail sat at 344..390, so
 *   .composer-call ended at x=366 — 22px underneath the rail — and the
 *   "New chat" control rendered 18x28 with its icon hidden by the
 *   `.new-chat span` rule, i.e. present and focusable but invisible.
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
  MIN_TARGET_PX,
} from './mobile-fixture';

test.skip(!MOBILE_FIXTURE_URL, MOBILE_FIXTURE_HINT);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function openHome(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`${MOBILE_FIXTURE_URL}/home.html`);
  await page.evaluate(() => document.fonts.ready);
  // Positive control: the real route component mounted. A blank fixture must
  // fail here rather than pass every geometry assertion vacuously.
  await expect(page.locator('.composer .composer-call')).toBeVisible();
  await expect(page.locator('.notes-dock')).toBeVisible();
}

async function box(page: Page, selector: string): Promise<Box> {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no layout box`);
  return rect;
}

for (const viewport of MOBILE_WIDTHS) {
  test(`Home keeps its controls clear of the notes rail at ${viewport.id}`, async ({ page }) => {
    await openHome(page, viewport.width, viewport.height);

    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(doc.scrollWidth).toBe(doc.clientWidth);

    // The collapsed rail is permanently visible, so it must take real width
    // instead of overlaying the chat column's controls.
    const dock = await box(page, '.notes-dock');
    const composer = await box(page, '.composer');
    const call = await box(page, '.composer-call');
    expect(composer.x + composer.width).toBeLessThanOrEqual(dock.x);
    expect(call.x + call.width).toBeLessThanOrEqual(dock.x);

    // Every Home control in the header and composer rows is visible and meets
    // the compact pointer-target floor.
    const targets = await page.evaluate(() =>
      [...document.querySelectorAll('.greeting-row button, .composer button')].map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') ?? (el as HTMLElement).title ?? '').trim(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          right: Math.round(rect.right),
          hidden: !(el as HTMLElement).offsetParent,
        };
      }),
    );
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target, `${target.name} is rendered`).toMatchObject({ hidden: false });
      expect(target.width, `${target.name} width`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      expect(target.height, `${target.name} height`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      expect(target.right, `${target.name} clears the notes rail`).toBeLessThanOrEqual(dock.x);
    }
  });
}

test('Home composer and call control are keyboard reachable at 390px', async ({ page }) => {
  const compact = MOBILE_WIDTHS[1];
  await openHome(page, compact.width, compact.height);

  await page.getByRole('textbox', { name: 'Chat with your agent' }).focus();
  const reached: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press('Tab');
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return '(none)';
        return (el.getAttribute('aria-label') || el.title || el.innerText || el.tagName).trim();
      }),
    );
    if (reached.at(-1) === 'Call your agent') break;
  }
  expect(reached.join(' -> ')).toContain('Call your agent');

  // The focused call control is the visible one inside the composer, not an
  // off-screen duplicate under the notes rail.
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const dock = document.querySelector('.notes-dock')!.getBoundingClientRect();
    return {
      inComposer: Boolean(el?.closest('.composer-call')),
      right: Math.round(rect?.right ?? 0),
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      dockLeft: Math.round(dock.x),
    };
  });
  expect(focused.inComposer).toBe(true);
  expect(focused.right).toBeLessThanOrEqual(focused.dockLeft);
  expect(Math.min(focused.width, focused.height)).toBeGreaterThanOrEqual(MIN_TARGET_PX);
});

test('Home desktop composition is unchanged by the compact repair', async ({ page }) => {
  await openHome(page, DESKTOP_CONTROL.width, DESKTOP_CONTROL.height);

  const doc = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(doc).toBe(DESKTOP_CONTROL.width);

  // The rail is a trailing flex item on desktop exactly as before: the column
  // ends where the dock starts, and the dock is not an overlay drawer.
  const dock = await box(page, '.notes-dock');
  const column = await box(page, '.column');
  expect(Math.round(column.x + column.width)).toBe(Math.round(dock.x));
  expect(await page.locator('.notes-dock').evaluate((el) => getComputedStyle(el).position)).toBe(
    'static',
  );
});
