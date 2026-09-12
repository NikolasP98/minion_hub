import { test, expect, type Page } from '@playwright/test';
type State = {
  updates: number;
  syncs: number;
  renders: number;
  liveSeen: number;
  stopped: boolean;
};
const snapshot = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __workshop: { snapshot(): State } }).__workshop.snapshot(),
  );
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === process.env.MINION_WORKSHOP_URL)
      await route.continue();
    else {
      failures.push('external request');
      await route.abort();
    }
  });
  page.on('pageerror', (error) => failures.push(error.message));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
test('actual pixel loop pauses motion but keeps live sync and render, then resumes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect.poll(async () => (await snapshot(page)).renders).toBeGreaterThan(5);
  expect((await snapshot(page)).updates).toBe(0);
  await page.evaluate(() =>
    (window as unknown as { __workshop: { updateLive(): void } }).__workshop.updateLive(),
  );
  await expect.poll(async () => (await snapshot(page)).liveSeen).toBe(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await snapshot(page)).updates).toBeGreaterThan(3);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Wait for the actual preference event to be delivered before freezing the sample.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const paused = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).renders).toBeGreaterThan(paused.renders + 5);
  expect((await snapshot(page)).updates).toBe(paused.updates);
  await page.evaluate(() =>
    (window as unknown as { __workshop: { stop(): void } }).__workshop.stop(),
  );
  const stopped = await snapshot(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(await snapshot(page)).toEqual(stopped);
});
for (const width of [390, 1280]) {
  test(`keyboard select and task submission preserve agent identity at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.locator('summary').focus();
    await page.keyboard.press('Enter');
    const select = page.getByRole('button', { name: 'Grace', exact: true });
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(select).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Selected agent')).toHaveText('agent-b');
    const assign = page.getByRole('button', { name: 'Assign task: Grace', exact: true });
    await assign.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Assign task', exact: true });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('textbox', { name: 'Describe task' });
    await expect(input).toBeFocused();
    await input.fill('Prepare report');
    const modifier = await page.evaluate(() =>
      /mac|iphone|ipad|ipod/i.test(navigator.platform + ' ' + navigator.userAgent)
        ? 'Meta'
        : 'Control',
    );
    await page.keyboard.press(`${modifier}+Enter`);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Submitted task')).toHaveText('agent-b: Prepare report');
    await expect(assign).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
  test(`Escape restores focus and offline task controls refuse at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await page.locator('summary').click();
    const assign = page.getByRole('button', { name: 'Assign task: Ada', exact: true });
    await assign.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(assign).toBeFocused();
    await page.getByRole('button', { name: 'Toggle connection' }).click();
    await expect(assign).toBeDisabled();
  });
}
