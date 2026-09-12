import { test, expect, type Page } from '@playwright/test';
interface MotionState {
  steps: number;
  position: { x: number; y: number } | null;
  classic: { scale: number[]; alpha: number } | null;
  habbo: { scale: number[] } | null;
  hover: number | null;
  reactions: { y: number; alpha: number }[][];
  tickerCount: number;
}
interface MotionApi {
  snapshot(): MotionState;
  pulse(): void;
  react(): void;
  move(): void;
  destroySprites(): void;
  stop(): void;
}
const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __motion: MotionApi }).__motion.snapshot());
const command = (page: Page, name: Exclude<keyof MotionApi, 'snapshot'>) =>
  page.evaluate((name) => (window as unknown as { __motion: MotionApi }).__motion[name](), name);
const listeners = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __motionListeners: Set<EventListener> }).__motionListeners.size,
  );
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, browser }, testInfo) => {
  await testInfo.attach('runtime', {
    body: JSON.stringify({
      browser: browser.browserType().name(),
      version: browser.version(),
      webkitExecutable: process.env.MINION_WEBKIT_EXECUTABLE ?? null,
    }),
    contentType: 'application/json',
  });
  const errors: string[] = [];
  failures.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('blob:') || new URL(url).origin === process.env.MINION_MOTION_URL)
      await route.continue();
    else {
      errors.push('external request');
      await route.abort();
    }
  });
  await page.addInitScript(() => {
    const current = new Set<EventListener>();
    Object.assign(window, { __motionListeners: current });
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = original(query);
      if (query !== '(prefers-reduced-motion: reduce)') return media;
      const add = media.addEventListener.bind(media);
      const remove = media.removeEventListener.bind(media);
      media.addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === 'change' && listener) current.add(listener as EventListener);
        add(type, listener, options);
      };
      media.removeEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === 'change' && listener) current.delete(listener as EventListener);
        remove(type, listener, options);
      };
      return media;
    };
  });
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});
async function load(page: Page, reduce: boolean) {
  await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
test('initial reduced preference keeps real Pixi geometry stable while real Rapier advances', async ({
  page,
}) => {
  await load(page, true);
  await command(page, 'pulse');
  await command(page, 'react');
  const before = await state(page);
  expect(before.classic).toEqual({ scale: [1.3, 1.6], alpha: 0.4 });
  expect(before.habbo?.scale).toEqual([1.2, 1.5]);
  expect(before.hover).toBe(0);
  expect(before.reactions).toEqual([[{ y: -30, alpha: 1 }], [{ y: -30, alpha: 1 }]]);
  await expect.poll(async () => (await state(page)).steps).toBeGreaterThan(before.steps + 5);
  const after = await state(page);
  expect(after.classic).toEqual(before.classic);
  expect(after.hover).toBe(0);
  expect(after.position?.x).not.toBe(before.position?.x);
  await command(page, 'move');
  expect((await state(page)).position?.x).toBeGreaterThan(300);
  await expect.poll(async () => (await state(page)).reactions).toEqual([[], []]);
  await command(page, 'destroySprites');
  expect(await listeners(page)).toBe(0);
  await command(page, 'stop');
});
test('live reduction resets pulses/reactions/hover without stopping physics and resumes hover', async ({
  page,
}) => {
  await load(page, false);
  await command(page, 'pulse');
  await command(page, 'react');
  await expect.poll(async () => (await state(page)).classic?.scale[0]).toBeGreaterThan(1.3);
  await expect.poll(async () => Math.abs((await state(page)).hover ?? 0)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(async () => (await state(page)).classic)
    .toEqual({ scale: [1.3, 1.6], alpha: 0.4 });
  expect((await state(page)).habbo?.scale).toEqual([1.2, 1.5]);
  expect((await state(page)).hover).toBe(0);
  const before = await state(page);
  await expect.poll(async () => (await state(page)).steps).toBeGreaterThan(before.steps + 4);
  expect((await state(page)).position?.x).not.toBe(before.position?.x);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => Math.abs((await state(page)).hover ?? 0)).toBeGreaterThan(0);
  await command(page, 'destroySprites');
  expect(await listeners(page)).toBe(0);
  expect((await state(page)).tickerCount).toBe(1); // only the unchanged physics callback
  await command(page, 'stop');
});
test('destroying native sprites during active effects removes all owned tickers and preference listeners', async ({
  page,
}) => {
  await load(page, false);
  await command(page, 'pulse');
  await command(page, 'react');
  expect(await listeners(page)).toBeGreaterThan(1);
  await command(page, 'destroySprites');
  expect(await listeners(page)).toBe(0);
  expect((await state(page)).tickerCount).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const before = await state(page);
  await expect.poll(async () => (await state(page)).steps).toBeGreaterThan(before.steps + 3);
  await command(page, 'stop');
});
