import { expect } from '@playwright/test';
import { test, MOBILE_FIXTURE_URL as URL } from './mobile-fixture';

for (const width of [360, 390, 768, 1440]) {
  test(`header/sidebar targets fit at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${URL}/index.html`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { name: 'Navigation fixture' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (width < 768) {
      const buttons = page.locator('header').first().getByRole('button');
      expect(await buttons.count()).toBeGreaterThan(2);
      for (const b of await buttons.all()) {
        const box = await b.boundingBox();
        if (!box) throw new Error('Missing target');
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    } else await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
  });
}
for (const persona of ['admin', 'restricted', 'personal']) {
  test(`mobile preserves permitted desktop links and order for ${persona}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${URL}/index.html?persona=${persona}`);
    const sidebar = page.getByRole('complementary', { name: 'Primary' });
    await expect(sidebar).toBeVisible();
    const desktop = await sidebar
      .locator('.sidebar-nav a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    if (persona === 'admin') expect(desktop[0]).toBe('/agents/workshop');
    const utilities = await sidebar
      .locator('.top-row a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    if (persona === 'admin')
      expect(utilities).toEqual(['/reliability', '/marketplace', '/cloud', '/killswitches']);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
    const mobile = await page
      .locator('.mobile-menu-nav a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(mobile).toEqual(desktop);
    for (const href of utilities)
      await expect(page.locator(`.mobile-menu-footer a[href="${href}"]`)).toBeVisible();
    for (const href of ['/reliability', '/marketplace', '/cloud', '/killswitches']) {
      const offered = await page.locator(`.mobile-menu-footer a[href="${href}"]`).count();
      expect(offered).toBe(utilities.includes(href) ? 1 : 0);
    }
  });
}
test('native menu dismisses with Escape, protects background and returns focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${URL}/index.html`);
  const trigger = page.getByRole('button', { name: 'Toggle menu', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Section navigation' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(':modal'))).toBe(true);
  await page.locator('#fixture-background').evaluate((el: HTMLElement) => el.focus());
  await expect(page.locator('#fixture-background')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
test('menu closes on desktop breakpoint and does not reopen on returning mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${URL}/index.html`);
  await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
  await expect(page.locator('.mobile-menu-nav')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mobile-menu-nav')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Toggle menu', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});
test('link selection closes the menu without triggering fixture navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${URL}/index.html`);
  const trigger = page.getByRole('button', { name: 'Toggle menu', exact: true });
  await trigger.click();
  await page.locator('.mobile-menu-nav a').first().click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: 'Navigation fixture' })).toBeVisible();
});

test('short reduced-motion menu keeps navigation and footer usable and dismisses outside', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${URL}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  const trigger = page.getByRole('button', { name: 'Toggle menu', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Section navigation' });
  await expect(dialog).toBeVisible();
  const footerGeometry = await dialog.locator('.mobile-menu-footer').evaluate((el) => {
    const parent = el.parentElement!;
    const style = getComputedStyle(parent);
    return {
      width: el.getBoundingClientRect().width,
      available:
        parent.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
    };
  });
  expect(Math.abs(footerGeometry.width - footerGeometry.available)).toBeLessThanOrEqual(1);
  const links = dialog.locator('a');
  for (const link of await links.all()) {
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    if (!box) throw new Error('Missing navigation target');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
  }
  // The application-wide reduced-motion rule keeps a 0.01ms transition for lifecycle events.
  const duration = await dialog
    .locator('.mobile-nav-link')
    .first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  await page.screenshot({ path: `${test.info().outputDir}/short-menu.png`, fullPage: true });
  // The native Sheet fills narrow screens; its outside surface exists above 448px.
  await page.setViewportSize({ width: 600, height: 640 });
  const bounds = await dialog.boundingBox();
  if (!bounds || bounds.x + bounds.width >= 600) throw new Error('Missing outside surface');
  await page.mouse.click(599, 320);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test.describe('fine-pointer desktop', () => {
  test.use({ hasTouch: false, viewport: { width: 1440, height: 900 } });
  test('keeps utility links visible and keyboard reachable without the mobile menu', async ({
    page,
  }) => {
    await page.goto(`${URL}/index.html`);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    const sidebar = page.getByRole('complementary', { name: 'Primary' });
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Toggle menu', exact: true })).not.toBeVisible();
    const utilities = sidebar.locator('.top-row a');
    await expect(utilities).toHaveCount(4);
    let previousRight = 0;
    for (const link of await utilities.all()) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      if (!box) throw new Error('Missing utility target');
      expect(box.x).toBeGreaterThanOrEqual(previousRight);
      previousRight = box.x + box.width;
      await link.focus();
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Navigation fixture' })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    await page.screenshot({
      path: `${test.info().outputDir}/desktop-navigation.png`,
      fullPage: true,
    });
  });
});

test('compact landscape keeps both navigation and utility controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 390 });
  await page.goto(`${URL}/index.html`);
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Section navigation' });
  await expect(dialog).toBeVisible();
  const body = dialog.locator('[data-part="body"]');
  expect(await body.evaluate((el) => el.clientHeight)).toBeGreaterThanOrEqual(44);
  const targets = dialog.locator(
    '.mobile-menu-nav a, .mobile-menu-footer a, .mobile-menu-footer button',
  );
  for (const target of await targets.all()) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('Missing landscape target');
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
  }
  await page.screenshot({
    path: `${test.info().outputDir}/landscape-navigation.png`,
    fullPage: true,
  });
});
