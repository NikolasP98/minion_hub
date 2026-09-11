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
async function open(page: Page) {
  await page.goto(`${MOBILE_FIXTURE_URL}/calls.html`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Call controls fixture' })).toBeVisible();
}
async function targetsFit(page: Page) {
  const buttons = page.getByRole('region', { name: 'Synthetic call controls' }).getByRole('button');
  expect(await buttons.count()).toBeGreaterThan(0);
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    if (!box) throw new Error('Call control has no layout');
    boxes.push(box);
    expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        'Call targets do not overlap',
      ).toBe(true);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
}
for (const viewport of [...MOBILE_WIDTHS, DESKTOP_CONTROL]) {
  test(`call targets and live row remain usable at ${viewport.id}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await open(page);
    await targetsFit(page);
    await page.getByRole('button', { name: 'Call your agent', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Call controls' })).toBeVisible();
    await targetsFit(page);
    await expect(page.getByRole('button', { name: 'Mute', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'End call', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('active-call.png') });
  });
}
test('language trigger has a complete current-language name and supports keyboard selection', async ({
  page,
}) => {
  await open(page);
  const language = page.locator('button').filter({ has: page.locator('.lang-pill') });
  await expect(language).toHaveAccessibleName('Language: Auto-detect');
  await language.focus();
  await page.keyboard.press('Enter');
  const english = page.getByRole('menuitem', { name: 'English', exact: true });
  await expect(english).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('menu')).toHaveAttribute(
    'aria-activedescendant',
    (await english.getAttribute('id'))!,
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Language: English', exact: true })).toBeFocused();
});
test('keyboard start, mute, unmute and end invoke only the synthetic callbacks', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Call your agent', exact: true }).focus();
  await page.keyboard.press('Enter');
  const mute = page.getByRole('button', { name: 'Mute', exact: true });
  await mute.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Space');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'End call', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Call your agent', exact: true })).toBeVisible();
  await expect(page.getByLabel('Synthetic callback counts')).toHaveText(
    '1 starts; 2 toggles; 1 ends',
  );
});
test('disabled start never admits a call', async ({ page }) => {
  await open(page);
  await page.getByLabel('Disable starting calls').check();
  await expect(page.getByRole('button', { name: 'Call your agent', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Synthetic callback counts')).toHaveText(
    '0 starts; 0 toggles; 0 ends',
  );
});
test('reduced motion removes the live call pulse', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.getByRole('button', { name: 'Call your agent', exact: true }).click();
  await expect(page.locator('.pulse.on')).toBeVisible();
  expect(await page.locator('.pulse.on').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none',
  );
});

test.describe('fine-pointer desktop', () => {
  test.use({ hasTouch: false, viewport: { width: 1440, height: 900 } });

  test('preserves compact desktop call geometry and keyboard operation with Home flow', async ({
    page,
  }) => {
    await open(page);
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    const language = page.getByRole('button', { name: 'Language: Auto-detect', exact: true });
    await language.focus();
    await page.keyboard.press('Enter');
    const english = page.getByRole('menuitem', { name: 'English', exact: true });
    await expect(english).toBeVisible();
    await expect(page.getByRole('menu')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menu')).toHaveAttribute(
      'aria-activedescendant',
      (await english.getAttribute('id'))!,
    );
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: 'Language: English', exact: true }),
    ).toBeFocused();
    const start = page.getByRole('button', { name: 'Call your agent', exact: true });
    expect((await start.boundingBox())?.height).toBe(40);
    await start.focus();
    await page.keyboard.press('Enter');
    const mute = page.getByRole('button', { name: 'Mute', exact: true });
    const end = page.getByRole('button', { name: 'End call', exact: true });
    const bounds = await Promise.all([mute.boundingBox(), end.boundingBox()]);
    expect(bounds[0]?.height).toBe(30);
    expect(bounds[1]?.height).toBe(30);
    expect(bounds[0]!.x + bounds[0]!.width).toBeLessThanOrEqual(bounds[1]!.x);
    await expect(mute).toBeVisible();
    await expect(end).toBeVisible();
    await mute.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await end.focus();
    await page.keyboard.press('Enter');
    await expect(start).toBeVisible();
    await expect(page.getByLabel('Synthetic callback counts')).toHaveText(
      '1 starts; 1 toggles; 1 ends',
    );

    // Actual Home composition, with no microphone/voice-session callback invoked.
    await page.goto(`${MOBILE_FIXTURE_URL}/home.html`);
    await page.evaluate(() => document.fonts.ready);
    const homeCall = page.getByRole('button', { name: 'Call your agent', exact: true });
    await expect(homeCall).toBeVisible();
    await homeCall.focus();
    await expect(homeCall).toBeFocused();
    expect((await homeCall.boundingBox())?.height).toBe(40);
    const flow = await page.evaluate(() => {
      const column = document.querySelector('.column')!.getBoundingClientRect();
      const dock = document.querySelector('.notes-dock')!.getBoundingClientRect();
      const composer = document.querySelector('.composer')!.getBoundingClientRect();
      return {
        right: column.right,
        dockLeft: dock.left,
        composerRight: composer.right,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(flow.overflow).toBe(false);
    expect(Math.round(flow.right)).toBe(Math.round(flow.dockLeft));
    expect(flow.composerRight).toBeLessThanOrEqual(flow.dockLeft);
    await page.screenshot({ path: test.info().outputPath('fine-desktop-home.png') });
  });
});
