import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

type Snapshot = {
  connected: boolean;
  requests: { method: string; params?: { message?: string } }[];
  unexpected: string[];
};
type FixtureWindow = Window & {
  __critical?: { snapshot(): Snapshot; releaseHandshake(): void; finishTurn(): void };
  __overlayFixture?: { fail(): void; succeed(): void; reopen(): Promise<void> };
};
const snapshot = (page: Page) =>
  page.evaluate(() => (window as FixtureWindow).__critical!.snapshot());
const violations = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, browser }, info) => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.env.MINION_CRITICAL_OUT!, 'manifest.json'), 'utf8'),
  ) as { files: { path: string }[] };
  const allowed = new Set(manifest.files.map((f) => '/' + f.path));
  const rejected: string[] = [];
  violations.set(page, rejected);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === 'http://127.0.0.1:18903' &&
      allowed.has(url.pathname) &&
      route.request().method() === 'GET'
    )
      await route.continue();
    else {
      rejected.push(route.request().url());
      await route.abort('blockedbyclient');
    }
  });
  page.on('websocket', (ws) => rejected.push('native WebSocket: ' + ws.url()));
  page.on('pageerror', (err) => rejected.push('pageerror: ' + err.message));
  await info.attach('runtime-identity', {
    body: JSON.stringify({
      browser: browser.version(),
      project: info.project.name,
      viewport: info.project.use.viewport,
      auth: 'none; synthetic fixture',
    }),
    contentType: 'application/json',
  });
});
test.afterEach(async ({ page }, info) => {
  await info.attach('network-boundary', {
    body: JSON.stringify({
      unexpectedNativeRequestsOrErrors: violations.get(page) ?? [],
      allowedOrigin: 'http://127.0.0.1:18903',
      transport: 'synthetic; no backend authentication',
    }),
    contentType: 'application/json',
  });
  expect(violations.get(page)).toEqual([]);
  if (page.url().includes('/home.html')) expect((await snapshot(page)).unexpected).toEqual([]);
});

test('CJ1 Home requires a completed real-client handshake before send', async ({ page }) => {
  await page.goto('/home.html?hold');
  const input = page.getByRole('textbox', { name: 'Chat with your agent' });
  await expect(input).toBeVisible();
  await expect
    .poll(async () => (await snapshot(page)).requests.filter((r) => r.method === 'connect').length)
    .toBe(1);
  expect((await snapshot(page)).connected).toBe(false);
  await input.fill('Blocked before handshake');
  await input.press('Enter');
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.send')).toHaveLength(0);
  await page.evaluate(() => (window as FixtureWindow).__critical!.releaseHandshake());
  await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
});

test('CJ2 Home sends once and renders the synthetic gateway response', async ({ page }) => {
  await page.goto('/home.html');
  await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
  const input = page.getByRole('textbox', { name: 'Chat with your agent' });
  await input.fill('Fixture request canary');
  await input.press('Enter');
  await expect
    .poll(
      async () => (await snapshot(page)).requests.filter((r) => r.method === 'chat.send').length,
    )
    .toBe(1);
  expect(
    (await snapshot(page)).requests.find((r) => r.method === 'chat.send')?.params?.message,
  ).toContain('Fixture request canary');
  await input.fill('Second request while the first turn is pending');
  await input.press('Enter');
  expect((await snapshot(page)).requests.filter((r) => r.method === 'chat.send')).toHaveLength(1);
  await page.evaluate(() => (window as FixtureWindow).__critical!.finishTurn());
  await expect(page.getByText('Synthetic response received.', { exact: true })).toBeVisible();
});

test('CJ3 Calendar staff lanes stay reachable', async ({ page }) => {
  await page.goto('/calendar.html');
  await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible();
  const lanes = page.locator('.ec-header .ec-day');
  await expect(lanes).toHaveCount(6);
  await lanes.last().scrollIntoViewIfNeeded();
  const box = await lanes.last().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(112);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});

test('CJ4 Secret save blocks dismissal and duplicate submission, then retries', async ({
  page,
}) => {
  await page.goto('/overlay.html');
  await page.locator('#open-secret').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Paste secret value').fill('synthetic-value');
  await dialog.getByRole('button', { name: 'Save & probe' }).click();
  await expect(page.locator('#fixture-state')).toHaveAttribute('data-saves', '1');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save & probe' })).toBeDisabled();
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.fail());
  await expect(dialog.getByText('Fixture save failed')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save & probe' }).click();
  await expect(page.locator('#fixture-state')).toHaveAttribute('data-saves', '2');
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.succeed());
  await expect(dialog.getByText('Verified test response', { exact: true })).toBeVisible();
  await dialog
    .getByRole('button', { name: 'Close', exact: true })
    .and(dialog.locator('[data-part="button"]'))
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#open-secret')).toBeFocused();
});

test('CJ5 Image dialog prevents background focus and returns it on Escape', async ({
  page,
}, info) => {
  await page.goto('/overlay.html');
  await page.locator('#open-image').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const focusStates = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => ({
      inDialog: document.querySelector('dialog[open]')?.contains(document.activeElement),
      documentFocused: document.hasFocus(),
      tag: document.activeElement?.tagName,
      id: document.activeElement?.id,
    }));
    focusStates.push(state);
    expect(
      state.inDialog || (!state.documentFocused && state.tag === 'BODY'),
      JSON.stringify(state),
    ).toBe(true);
  }
  await info.attach('native-focus-states', {
    body: JSON.stringify(focusStates),
    contentType: 'application/json',
  });
  await page.locator('#background').focus();
  await expect(page.locator('#background')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#open-image')).toBeFocused();
});

test('CJ6 Secret close and rapid reopen retain a working native dialog', async ({ page }) => {
  await page.goto('/overlay.html');
  await page.locator('#open-secret').click();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).__overlayFixture!.reopen());
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#open-secret')).toBeFocused();
});
