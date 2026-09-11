import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reduced-motion + nonvisual chart access (UI-06 shared slice).
 *
 * `bun run dev`/`vitest` in this snapshot go through Vite's dependency
 * OPTIMIZER, which is broken in this environment for an unrelated,
 * pre-existing reason (reproduces on a totally empty smoke test — see
 * 13-04-SUMMARY.md). Production `vite build` does not use that optimizer at
 * all, so this spec follows the exact fixture pattern 13-01 used for the same
 * reason (`tests/fixtures/overlay-native/`): build a small, credential-free,
 * production bundle of the REAL CrmSentimentTrend + Chart components with
 * synthetic data, serve it statically, and drive it with Playwright. No app
 * auth, org data or dev server is involved.
 *
 * This is also where Task 2's "observe actual animation engine state, not
 * document.getAnimations alone" instruction is executed: ECharts draws to a
 * <canvas>, which the Web Animations API cannot see, so motion is verified by
 * diffing real screenshots of the chart across time instead.
 */

const HUB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
let fixtureDir: string;
let fixtureUrl: string;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

let server: Server;
let blockedRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  blockedRequests = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === fixtureUrl) await route.continue();
    else {
      blockedRequests.push(route.request().url());
      await route.abort();
    }
  });
  await page.routeWebSocket('**/*', (socket) => {
    blockedRequests.push(socket.url());
    socket.close();
  });
});

test.afterEach(() => {
  expect(blockedRequests, 'Chart fixture attempted unexpected network traffic').toEqual([]);
});

test.beforeAll(async () => {
  fixtureDir = await mkdtemp('/tmp/minion-chart-accessibility-');
  execFileSync('node', [path.join(HUB_ROOT, 'tests/fixtures/chart-accessibility/build.mjs')], {
    cwd: HUB_ROOT,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: fixtureDir,
      LANG: 'C.UTF-8',
      MINION_CHART_FIXTURE_OUT: fixtureDir,
    },
    stdio: 'inherit',
  });

  server = createServer((req, res) => {
    const reqUrl = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
    let filePath: string;
    try {
      filePath = path.resolve(fixtureDir, '.' + decodeURIComponent(reqUrl.split('?')[0] ?? ''));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (!filePath.startsWith(fixtureDir + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    readFile(filePath)
      .then((body) => {
        const type = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404);
        res.end('not found');
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener');
  fixtureUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server?.listening)
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
});

async function gotoFixture(page: Page) {
  await page.goto(fixtureUrl);
  await page.locator('#chart-region [role="img"]').waitFor();
}

test.describe('Chart nonvisual data contract (real CrmSentimentTrend + Chart)', () => {
  test('gives the chart an accessible name describing its content', async ({ page }) => {
    await gotoFixture(page);
    const region = page.locator('#chart-region [role="img"]');
    await expect(region).toHaveAttribute('aria-label', 'Monthly customer-sentiment trend');
  });

  test('exposes the actual series values as a real, escaped table alternative', async ({
    page,
  }) => {
    await gotoFixture(page);
    const details = page.locator('#chart-region details.chart-alt');
    await expect(details.locator('summary')).toHaveText('View chart data as table');
    // Not yet open — the table is a disclosure, not forced visual clutter.
    await expect(details).not.toHaveAttribute('open', '');

    const table = details.locator('table');
    await expect(table.locator('thead th').nth(0)).toHaveText('Date');
    await expect(table.locator('thead th').nth(1)).toHaveText('Customer sentiment');
    // Category values render through the SAME axisLabel.formatter the visible
    // axis uses — "Aug 1", not the raw ISO string fed to xAxis.data.
    await expect(table.locator('tbody tr').nth(0).locator('th')).toHaveText('Aug 1');
    await expect(table.locator('tbody tr').nth(0).locator('td')).toHaveText('+0.42');
    await expect(table.locator('tbody tr').nth(1).locator('th')).toHaveText('Aug 2');
    await expect(table.locator('tbody tr').nth(1).locator('td')).toHaveText('-0.10');
  });

  test('the data-table disclosure opens with a plain Enter key — no pointer, no bespoke script', async ({
    page,
  }) => {
    await gotoFixture(page);
    const summary = page.locator('#chart-region summary');
    await summary.focus();
    await expect(page.locator('#chart-region details.chart-alt')).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(page.locator('#chart-region details.chart-alt')).toHaveAttribute('open', '');
  });
});

test('formatted object values update and table remains outside image accessibility subtree', async ({
  page,
}) => {
  await gotoFixture(page);
  const chart = page.locator('#formatted-chart');
  await chart.locator('summary').click();
  await expect(chart.getByRole('table', { name: 'Revenue by day' })).toBeVisible();
  await expect(chart.locator('[role="img"] table')).toHaveCount(0);
  await expect(chart.locator('tbody th')).toHaveText('Day A');
  await expect(chart.locator('td')).toHaveText('USD 2.50');
  await page.getByLabel('Update chart fixture').check();
  await expect(chart.locator('tbody th')).toHaveText('Day B');
  await expect(chart.locator('td')).toHaveText('USD 7.50');
});

test('wide chart data stays inside a mobile page and supports keyboard scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoFixture(page);
  await page.locator('#wide-chart summary').click();
  const region = page.locator('#wide-chart [role="region"]');
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAccessibleName('Wide chart values: View chart data as table');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await region.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(page.locator('#wide-chart table tbody td')).toHaveCount(8);
  await page.screenshot({ path: test.info().outputPath('mobile-chart-table.png') });
});

test.describe('Reduced motion actually stops chart drawing animation', () => {
  test('animation:false paints once and stays byte-identical over time', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoFixture(page);
    const region = page.locator('#chart-region');
    const early = await region.screenshot();
    await page.waitForTimeout(1200);
    const late = await region.screenshot();
    expect(early.equals(late)).toBe(true);
  });

  test('without reduced motion, the entrance animation actually redraws the canvas over time', async ({
    page,
  }) => {
    await gotoFixture(page);
    const region = page.locator('#chart-region');
    // ECharts' default entrance animation runs ~1000ms; sampling well inside
    // vs. well after that window must show a real pixel difference, or the
    // "reduced motion actually removes something" claim above is unfalsifiable.
    await page.waitForTimeout(150);
    const early = await region.screenshot();
    await page.waitForTimeout(1200);
    const late = await region.screenshot();
    expect(early.equals(late)).toBe(false);
  });
});

// TODO(handoff): Workshop/Pixi/physics operation parity needs real engine fixtures;
// track in .planning/phases/13-ui-qualification/13-CANVAS-COVERAGE.md.
// Source regexes asserting missing accessibility are not acceptance tests.
