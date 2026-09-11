import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
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
const FIXTURE_DIR = '/tmp/minion-chart-accessibility-fixture';
const FIXTURE_PORT = 5296;
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

let server: Server;

test.beforeAll(async () => {
  execFileSync('node', [path.join(HUB_ROOT, 'tests/fixtures/chart-accessibility/build.mjs')], {
    cwd: HUB_ROOT,
    env: { ...process.env, MINION_CHART_FIXTURE_OUT: FIXTURE_DIR },
    stdio: 'inherit',
  });

  server = createServer((req, res) => {
    const reqUrl = req.url === '/' ? '/index.html' : (req.url ?? '/index.html');
    const filePath = path.join(FIXTURE_DIR, decodeURIComponent(reqUrl.split('?')[0] ?? ''));
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
  await new Promise<void>((resolve) => server.listen(FIXTURE_PORT, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function gotoFixture(page: Page) {
  await page.goto(FIXTURE_URL);
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
    await expect(table.locator('tbody tr').nth(0).locator('td')).toHaveText('0.42');
    await expect(table.locator('tbody tr').nth(1).locator('th')).toHaveText('Aug 2');
    await expect(table.locator('tbody tr').nth(1).locator('td')).toHaveText('-0.1');
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

test.describe('Workshop canvas — inventory-only tracked gaps (whole-canvas closure out of scope for this slice)', () => {
  test('pixel game loop has no reduced-motion or nonvisual handling yet (tracked in 13-CANVAS-COVERAGE.md)', async () => {
    const src = await readFile(path.join(HUB_ROOT, 'src/lib/workshop/pixel/game-loop.ts'), 'utf8');
    // This assertion is a deliberate canary: it is EXPECTED to fail the day
    // someone adds reduced-motion support here, forcing 13-CANVAS-COVERAGE.md
    // to be updated alongside the fix rather than silently going stale.
    expect(src).not.toMatch(/prefers-reduced-motion|matchMedia/);
  });

  test('habbo-renderer has no aria or keyboard affordances yet (tracked in 13-CANVAS-COVERAGE.md)', async () => {
    const src = await readFile(path.join(HUB_ROOT, 'src/lib/workshop/habbo-renderer.ts'), 'utf8');
    expect(src).not.toMatch(/aria-|role=|tabindex|prefers-reduced-motion/);
  });

  test('WorkshopCanvas has a named application region but still no reduced-motion handling (tracked)', async () => {
    const src = await readFile(
      path.join(HUB_ROOT, 'src/lib/components/workshop/WorkshopCanvas.svelte'),
      'utf8',
    );
    expect(src).toContain('role="application"');
    expect(src).not.toMatch(/prefers-reduced-motion|matchMedia/);
  });
});
