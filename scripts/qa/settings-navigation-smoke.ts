#!/usr/bin/env bun
/** Exercise the real shell against disposable seeded QA, including browser layout. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  chromium,
  expect as browserExpect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { parseEnvFile } from './snapshot-env';
import { personaEmail, QA_PASSWORD } from './seed/ids';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199';
// The first client-only page loads a cold Vite graph. Action timeouts do not
// configure Playwright's independent expect timeout (which defaults to 5s).
const expect = browserExpect.configure({ timeout: 60_000 });
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback synthetic QA only');
const qa = parseEnvFile(await readFile('.env.qa.local', 'utf8'));
const out = 'test-results/ui-audit/settings-navigation';
await mkdir(out, { recursive: true });
const checks: string[] = [];
const browser = await chromium.launch({ headless: true });
const returnPath = '/en/account/home?settings-return=qa#selection';
let lastPage: Page | undefined;
const pageErrors: string[] = [];
const ownerEvidence: { checkpoint: string; state: unknown }[] = [];
async function recordOwner(page: Page, checkpoint: string) {
  const state = await page.evaluate(async (expectedHref) => {
    const path = '/src/lib/nav/settings-navigation.qa.ts';
    try {
      const probe: { readSettingsNavigation(href: string): unknown } = await import(path);
      return probe.readSettingsNavigation(expectedHref);
    } catch (error) {
      const response = await fetch(path);
      return {
        diagnosticError: String(error),
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: (await response.text()).slice(0, 1200),
      };
    }
  }, returnPath);
  ownerEvidence.push({ checkpoint, state });
}
const repeatedLocaleNavigations: string[] = [];
function watchLocaleNavigation(page: Page) {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    if (/^\/(?:en|es)\/(?:en|es)(?:\/|$)/.test(new URL(frame.url()).pathname))
      repeatedLocaleNavigations.push(frame.url());
  });
}
const navigationEvidence: {
  checkpoint: string;
  url: string;
  document: number;
  back: string | null;
}[] = [];
let flowDocument: number | undefined;

async function login(context: BrowserContext, persona: string) {
  const response = await context.request.post(`${base}/api/auth/password-login`, {
    data: {
      identifier: personaEmail(`tenancy.user.${persona}`),
      password: qa.QA_SEED_PASSWORD ?? QA_PASSWORD,
    },
  });
  assert.equal(response.status(), 200, `Synthetic ${persona} login`);
}
async function shot(page: Page, name: string) {
  await recordOwner(page, name);
  assert.deepEqual(repeatedLocaleNavigations, [], 'No transient doubled-locale navigation');
  const document = await page.evaluate(() => performance.timeOrigin);
  const back = await page
    .locator('aside[aria-label="Primary"] a[aria-label="Back"]')
    .evaluateAll((nodes) => nodes[0]?.getAttribute('href') ?? null);
  navigationEvidence.push({ checkpoint: name, url: page.url(), document, back });
  if (flowDocument !== undefined)
    assert.equal(document, flowDocument, 'No full reload during the session-only return flow');
  await page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
  checks.push(name);
  await writeFile(
    `${out}/checks.json`,
    JSON.stringify(
      {
        checks,
        navigationEvidence,
        ownerEvidence,
        repeatedLocaleNavigations,
        transport: 'seeded loopback QA',
      },
      null,
      2,
    ),
  );
}
function primary(page: Page) {
  return page.locator('aside[aria-label="Primary"] [data-layout="primary"]');
}
async function avatarSettings(page: Page) {
  // Production has no query inspector. Its development-only floating logo
  // overlaps the avatar in the QA Vite server; keep real app clicks unobstructed.
  await page.addStyleTag({ content: '.tsqd-parent-container { display: none !important; }' });
  await page.getByRole('button', { name: 'Profile menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole('heading', { name: 'Language', exact: true })).toBeVisible();
}
async function vertical(nav: Locator) {
  await expect(nav).toBeVisible();
  const geometry = await nav.evaluate((node) => {
    const groups = [...node.querySelectorAll('.nav-group')];
    const items = [...node.querySelectorAll('.nav-item')].map((item) =>
      item.getBoundingClientRect(),
    );
    return {
      groupDirections: groups.map((group) => getComputedStyle(group).flexDirection),
      itemY: items.map((rect) => rect.y),
      itemHeights: items.map((rect) => rect.height),
      width: node.getBoundingClientRect().width,
      scrollWidth: node.scrollWidth,
    };
  });
  assert(geometry.groupDirections.every((direction) => direction === 'column'));
  assert(geometry.itemY.every((y, i, rows) => i === 0 || y > rows[i - 1]!));
  assert(geometry.itemHeights.every((height) => height >= 44));
  assert(geometry.scrollWidth <= geometry.width + 1);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  context.setDefaultTimeout(45_000);
  await login(context, 'platform-admin');
  const page = await context.newPage();
  watchLocaleNavigation(page);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  lastPage = page;
  await page.goto(`${base}${returnPath}`);
  await expect(page.locator('.section-card').first()).toBeVisible();
  await page.evaluate(() => localStorage.setItem('hub-sidebar-collapsed', '1'));
  await page.reload();
  await expect(page.locator('aside[aria-label="Primary"]')).toHaveClass(/is-collapsed/);
  // The dev-only inspector is lazy loaded; wait until its optimizer work has
  // settled before qualifying session-only state across client navigation.
  await expect(
    page.getByRole('button', { name: 'Open Tanstack query devtools', exact: true }),
  ).toBeVisible();
  flowDocument = await page.evaluate(() => performance.timeOrigin);
  await recordOwner(page, 'home-before-settings');
  await avatarSettings(page);
  await expect(page.locator('aside[aria-label="Primary"]')).not.toHaveClass(/is-collapsed/);
  assert.equal(await page.evaluate(() => localStorage.getItem('hub-sidebar-collapsed')), '1');
  await expect(page.locator('.switcher-wrap')).toHaveCount(0);
  await expect(page.locator('aside[aria-label="Primary"] .top-row')).toHaveCount(0);
  await expect(page.locator('[data-component="section-nav"]:visible')).toHaveCount(1);
  await expect
    .poll(async () => (await page.locator('aside[aria-label="Primary"]').boundingBox())?.width ?? 0)
    .toBeGreaterThan(220);
  await vertical(primary(page));
  await shot(page, 'desktop-settings-layer');

  await primary(page).getByRole('searchbox').fill('Plugins');
  await expect(primary(page).getByRole('link', { name: 'Appearance', exact: true })).toHaveCount(0);
  await primary(page).getByRole('link', { name: 'Plugins', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/plugins$/);
  await shot(page, 'search-and-plugin-navigation');
  await primary(page).getByRole('searchbox').fill('');
  await primary(page).getByRole('button', { name: 'Security', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?s=security$/);
  await expect(
    primary(page).getByRole('button', { name: 'Security', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await shot(page, 'gateway-tab-selection');

  // The CI stack has no live gateway. Mark the actual config state dirty in
  // memory to exercise its real navigation guard; never save config or call a model.
  await page.evaluate(async () => {
    const modulePath = '/src/lib/state/config/config.svelte.ts';
    const config: { setField(path: string, value: unknown): void } = await import(modulePath);
    config.setField('settingsNavigationQaProbe', true);
  });
  await expect(
    page.locator('aside[aria-label="Primary"]').getByRole('link', { name: 'Back', exact: true }),
  ).toHaveAttribute('href', returnPath);
  await page
    .locator('aside[aria-label="Primary"]')
    .getByRole('link', { name: 'Back', exact: true })
    .click();
  const guardHeading = page.getByRole('heading', { name: 'You have unsaved changes', exact: true });
  const guard = guardHeading.locator('..');
  await expect(guardHeading).toBeVisible();
  await guard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\?s=security$/);
  await shot(page, 'dirty-back-cancelled');
  await page
    .locator('aside[aria-label="Primary"]')
    .getByRole('link', { name: 'Back', exact: true })
    .click();
  await guard.getByRole('button', { name: 'Discard', exact: true }).click();
  // TODO(handoff): Complete Back/history/mobile qualification after the owner
  // requested merge before the blocked CI retry. See minion-meta proposal
  // 2026-11-08-hub-settings-browser-qualification-followup.
  await expect(page).toHaveURL(`${base}${returnPath}`);
  await expect(page.locator('aside[aria-label="Primary"]')).toHaveClass(/is-collapsed/);
  await shot(page, 'back-restores-query-hash-and-collapse');

  await page.goBack();
  await expect(page).toHaveURL(/\/settings\?s=security$/);
  await expect(primary(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`${base}${returnPath}`);
  await expect(primary(page)).toHaveCount(0);
  await shot(page, 'browser-history-restores-layer');

  flowDocument = undefined;
  await page.goto(`${base}/en/settings/appearance`);
  await expect(primary(page)).toBeVisible();
  await page.reload();
  await expect(
    page.locator('aside[aria-label="Primary"]').getByRole('link', { name: 'Back', exact: true }),
  ).toHaveAttribute('href', /\/account\/home$/);
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('[data-component="section-nav"]:visible')).toHaveCount(1);
  await vertical(primary(page));
  await shot(page, 'intermediate-width-vertical');
  await context.close();

  const staff = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  staff.setDefaultTimeout(45_000);
  await login(staff, 'staff');
  const mobile = await staff.newPage();
  watchLocaleNavigation(mobile);
  mobile.on('pageerror', (error) => pageErrors.push(error.message));
  lastPage = mobile;
  await mobile.goto(`${base}/en/account/home`);
  await expect(mobile.locator('.section-card').first()).toBeVisible();
  await avatarSettings(mobile);
  await mobile.getByRole('button', { name: 'Toggle menu', exact: true }).click();
  const sheet = mobile.getByRole('dialog');
  const mobileNav = sheet.locator('[data-layout="primary"]');
  await expect(mobile.locator('[data-component="section-nav"]:visible')).toHaveCount(1);
  await vertical(mobileNav);
  await expect(sheet.getByRole('link', { name: 'Organizations', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: 'Plugins', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Security', exact: true })).toHaveCount(0);
  assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot(mobile, 'staff-mobile-settings');
  // Staff cannot manage plugin settings. Exercise the permitted native link
  // and its navigation-completion close behavior without widening permissions.
  await mobileNav.getByRole('link', { name: 'Appearance', exact: true }).click();
  await expect(mobile).toHaveURL(/\/settings\/appearance$/);
  await expect(sheet).not.toBeVisible();
  await mobile.getByRole('button', { name: 'Toggle menu', exact: true }).click();
  await sheet.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(mobile).toHaveURL(`${base}/en/account/home`);
  await expect(sheet).not.toBeVisible();
  await shot(mobile, 'mobile-back-restores-personal-home');
  await staff.close();
  console.log(`Settings navigation QA: ${checks.length} browser checkpoints passed`);
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage
      .screenshot({ path: `${out}/failure.png`, animations: 'disabled' })
      .catch(() => {});
    await writeFile(
      `${out}/failure.json`,
      JSON.stringify(
        {
          url: lastPage.url(),
          checks,
          navigationEvidence,
          document: await lastPage.evaluate(() => performance.timeOrigin).catch(() => null),
          error: String(error),
          pageErrors,
          ownerEvidence,
          repeatedLocaleNavigations,
        },
        null,
        2,
      ),
    );
  }
  throw error;
} finally {
  await browser.close();
}
