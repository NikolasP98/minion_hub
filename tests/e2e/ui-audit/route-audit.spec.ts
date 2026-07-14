import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { configuredPersona, type CapturePersonaId } from './personas';
import { captureFixtures, resolveFixture } from './fixtures';
import {
  assertCriticalRuntimeDiagnostics,
  collectRuntimeUiDiagnostics,
} from './runtime-diagnostics';

interface InventoryRoute {
  id: string;
  pattern: string;
  family: 'app' | 'public';
  kind: 'screen' | 'redirect';
  dynamic: boolean;
  redirectContract?: {
    probePath: string;
    statuses: number[];
    location?: string;
    locations?: string[];
    outcomes: string[];
  };
}

const enabled = process.env.E2E_UI_AUDIT === '1';
const outputDir = path.resolve('test-results/ui-audit');
const inventoryPath = path.join(outputDir, 'route-inventory.json');

test('authenticated route inventory produces a machine-readable audit run', async ({
  page,
}, testInfo) => {
  test.skip(
    !enabled,
    'Set E2E_UI_AUDIT=1 and deterministic persona credentials to run the UI audit.',
  );
  mkdirSync(outputDir, { recursive: true });
  execFileSync(process.execPath, ['scripts/ui-audit-inventory.mjs', `--out=${inventoryPath}`], {
    stdio: 'inherit',
  });
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
    baseCommit: string;
    routes: InventoryRoute[];
  };
  const personaId = (process.env.E2E_UI_AUDIT_PERSONA ?? 'owner') as CapturePersonaId;
  const persona = configuredPersona(personaId);
  expect(persona, `Missing deterministic credentials for ${personaId}`).not.toBeNull();

  await page.goto('/login');
  await page.locator('#login-identifier').fill(process.env[persona!.emailEnv]!);
  await page.locator('#login-password').fill(process.env[persona!.passwordEnv]!);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

  const fixtures = captureFixtures();
  const viewport =
    process.env.E2E_UI_AUDIT_VIEWPORT === 'compact'
      ? { width: 390, height: 844, id: 'compact' }
      : process.env.E2E_UI_AUDIT_VIEWPORT === 'medium'
        ? { width: 768, height: 1024, id: 'medium' }
        : { width: 1440, height: 900, id: 'wide' };
  await page.setViewportSize(viewport);

  const results: Array<Record<string, unknown>> = [];
  for (const route of inventory.routes.filter((candidate) => candidate.kind === 'screen')) {
    const url = route.dynamic ? resolveFixture(route.pattern, fixtures) : route.pattern;
    if (!url) {
      results.push({ routeId: route.id, pattern: route.pattern, outcome: 'missing-fixture' });
      continue;
    }
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const networkFailures: string[] = [];
    const failedSameOriginGets: string[] = [];
    const onConsole = (message: { type(): string; text(): string }) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    };
    const onRequestFailed = (request: {
      url(): string;
      failure(): { errorText: string } | null;
    }) => {
      networkFailures.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
    };
    const onPageError = (error: Error) => pageErrors.push(error.message);
    const onResponse = (response: {
      url(): string;
      status(): number;
      request(): { method(): string };
    }) => {
      const url = new URL(response.url());
      if (
        url.origin === new URL(page.url()).origin &&
        response.request().method() === 'GET' &&
        response.status() >= 400
      ) {
        failedSameOriginGets.push(`${response.status()} ${url.pathname}${url.search}`);
      }
    };
    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('requestfailed', onRequestFailed);
    page.on('response', onResponse);
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const diagnostics = await collectRuntimeUiDiagnostics(page);
    const screenshot = path.join(outputDir, `${personaId}--${viewport.id}--${route.id}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({
      routeId: route.id,
      pattern: route.pattern,
      resolvedUrl: url,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      outcome: /\/(login|onboarding)(?:\/|$)/.test(new URL(page.url()).pathname)
        ? 'auth-or-onboarding-redirect'
        : 'captured',
      screenshot: path.relative(process.cwd(), screenshot),
      consoleErrors,
      pageErrors,
      networkFailures,
      failedSameOriginGets,
      diagnostics,
    });
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    assertCriticalRuntimeDiagnostics(diagnostics, route.id);
  }

  for (const route of inventory.routes.filter((candidate) => candidate.kind === 'redirect')) {
    const contract = route.redirectContract;
    expect(contract, `${route.pattern} is missing a redirect contract`).toBeTruthy();
    const response = await page.request.get(contract!.probePath, { maxRedirects: 0 });
    const status = response.status();
    const locationHeader = response.headers().location ?? null;
    expect(contract!.statuses, `${route.pattern} returned ${status}`).toContain(status);

    let resolvedLocation: string | null = null;
    if (locationHeader) {
      const location = new URL(locationHeader, page.url());
      resolvedLocation = `${location.pathname}${location.search}`;
    }
    if (status >= 300 && status < 400) {
      if (contract!.location) expect(resolvedLocation).toBe(contract!.location);
      if (contract!.locations) expect(contract!.locations).toContain(resolvedLocation);
    } else {
      expect(status, `${route.pattern} may only deny access instead of redirecting`).toBe(403);
    }
    results.push({
      routeId: route.id,
      pattern: route.pattern,
      probePath: contract!.probePath,
      status,
      location: resolvedLocation,
      expectedOutcomes: contract!.outcomes,
      outcome: status === 403 ? 'permission-denied-verified' : 'redirect-verified',
    });
  }

  const run = {
    schemaVersion: 1,
    appCommit: inventory.baseCommit,
    fixtureVersion: process.env.E2E_UI_AUDIT_FIXTURE_VERSION ?? 'unversioned',
    persona: personaId,
    viewport,
    project: testInfo.project.name,
    results,
  };
  writeFileSync(
    path.join(outputDir, `run-${personaId}-${viewport.id}.json`),
    `${JSON.stringify(run, null, 2)}\n`,
  );
  expect(results.filter((result) => result.outcome === 'auth-or-onboarding-redirect')).toEqual([]);
  expect(results.filter((result) => result.outcome === 'missing-fixture')).toEqual([]);
});
