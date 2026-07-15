import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  prepareCapturePlanEntry,
  resetCapturePlanEntry,
  resolveCaptureMatrix,
} from '../../../src/lib/routes/capture-route-resolver';
import {
  REDIRECT_DESIGN_MANIFEST,
  SCREEN_DESIGN_MANIFEST,
} from '../../../src/lib/routes/route-design-manifest';
import { runRouteCertification, requiresSingleVisibleTitle } from './certification';
import { captureFixtures, resolveFixtureProvision } from './fixtures';
import {
  capturePersona,
  personaCredentials,
  selectedPersonaIds,
  type CapturePersona,
} from './personas';
import {
  attachRunArtifact,
  summarizeResults,
  writeRunArtifact,
  type CaptureRunArtifact,
  type CaptureRunResult,
} from './run-artifact';
import { CaptureScenarioBlockedError, CaptureScenarioHooks } from './scenario-hooks';
import {
  assertCaptureContentReady,
  assertScreenshotHasVisualDiversity,
  isOutdatedOptimizeDepMessage,
  navigateToCaptureRoute,
} from './capture-readiness';
import {
  assertCriticalRuntimeDiagnostics,
  collectRuntimeUiDiagnostics,
  type RuntimeUiDiagnosticOptions,
} from './runtime-diagnostics';
import {
  prepareAnonymousAuditTheme,
  prepareAuditTheme,
  resolveAuditTheme,
  restoreAuditTheme,
} from './themes';
import { resolveAuditViewport } from './viewports';

interface InventoryRoute {
  id: string;
  pattern: string;
  kind: 'screen' | 'redirect';
  redirectContract?: {
    probePath: string;
    statuses: number[];
    location?: string;
    locations?: string[];
    outcomes: string[];
  };
}

interface Inventory {
  baseCommit: string;
  routes: InventoryRoute[];
}

class MissingCaptureFixtureError extends Error {
  constructor(fixtureId: string) {
    super(
      `Fixture ${fixtureId} is absent from E2E_UI_AUDIT_FIXTURES. Seed the disposable local audit tenant; do not substitute production data.`,
    );
    this.name = 'MissingCaptureFixtureError';
  }
}

const enabled = process.env.E2E_UI_AUDIT === '1';
const outputDir = path.resolve('test-results/ui-audit');
const inventoryPath = path.join(outputDir, 'route-inventory.json');

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
}

function routeFilter(): Set<string> {
  return new Set(
    (process.env.E2E_UI_AUDIT_ROUTES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function authenticate(page: Page, persona: CapturePersona): Promise<string | undefined> {
  await page.context().clearCookies();
  if (persona.id === 'anonymous') return undefined;
  const credentials = personaCredentials(persona, process.env);
  if (!credentials) {
    return `Missing deterministic credentials in ${persona.emailEnv} and ${persona.passwordEnv}.`;
  }
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.locator('#login-identifier').fill(credentials.email);
  await page.locator('#login-password').fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  try {
    await expect(page).not.toHaveURL(/\/login(?:\/|$)/, { timeout: 15_000 });
  } catch {
    return `Deterministic ${persona.id} login did not complete. The disposable auth schema or seeded account is unavailable.`;
  }
  return undefined;
}

function captureEvents(page: Page, appOrigin: string) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkFailures: string[] = [];
  const failedSameOriginGets: string[] = [];
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onRequestFailed = (request: { url(): string; failure(): { errorText: string } | null }) =>
    networkFailures.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onResponse = (response: {
    url(): string;
    status(): number;
    request(): { method(): string; resourceType(): string };
  }) => {
    const url = new URL(response.url());
    const expectedStateDocument =
      response.request().resourceType() === 'document' &&
      (response.status() === 403 || response.status() === 404);
    if (
      url.origin === appOrigin &&
      response.request().method() === 'GET' &&
      response.status() >= 400 &&
      !expectedStateDocument
    ) {
      failedSameOriginGets.push(`${response.status()} ${url.pathname}${url.search}`);
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  return {
    consoleErrors,
    pageErrors,
    networkFailures,
    failedSameOriginGets,
    discardRecoveredViteOptimizeDeps(urls: readonly string[]) {
      if (urls.length === 0) return;
      const recoveredUrls = urls.flatMap((value) => {
        const url = new URL(value);
        return [value, `${url.pathname}${url.search}`];
      });
      const recoveredGets = new Set(
        recoveredUrls.filter((value) => value.startsWith('/')).map((value) => `504 ${value}`),
      );
      const removeMatching = (values: string[], predicate: (value: string) => boolean) => {
        for (let index = values.length - 1; index >= 0; index -= 1) {
          if (predicate(values[index] ?? '')) values.splice(index, 1);
        }
      };
      const mentionsRecoveredUrl = (value: string) =>
        recoveredUrls.some((recoveredUrl) => value.includes(recoveredUrl));
      removeMatching(failedSameOriginGets, (value) => recoveredGets.has(value));
      removeMatching(
        pageErrors,
        (value) => mentionsRecoveredUrl(value) || isOutdatedOptimizeDepMessage(value),
      );
      removeMatching(networkFailures, mentionsRecoveredUrl);
      removeMatching(
        consoleErrors,
        (value) =>
          mentionsRecoveredUrl(value) ||
          isOutdatedOptimizeDepMessage(value) ||
          (/failed to load resource/i.test(value) && /\b504\b/.test(value)),
      );
    },
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}

test('manifest capture matrix produces a stateful machine-readable certification run', async ({
  page,
}, testInfo) => {
  test.skip(
    !enabled,
    'Set E2E_UI_AUDIT=1 and seed a disposable local audit tenant to run UI capture.',
  );
  mkdirSync(outputDir, { recursive: true });
  execFileSync(process.execPath, ['scripts/ui-audit-inventory.mjs', `--out=${inventoryPath}`], {
    stdio: 'inherit',
  });
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
  const filter = routeFilter();
  const selectedRoutes = SCREEN_DESIGN_MANIFEST.filter(
    (route) => filter.size === 0 || filter.has(route.pattern),
  );
  if (filter.size > 0) {
    const resolved = new Set(selectedRoutes.map((route) => route.pattern));
    expect(
      [...filter].filter((pattern) => !resolved.has(pattern)),
      'Every E2E_UI_AUDIT_ROUTES entry must resolve to a screen endpoint',
    ).toEqual([]);
  }
  const inventoryScreens = new Set(
    inventory.routes.filter((route) => route.kind === 'screen').map((route) => route.pattern),
  );
  expect(
    selectedRoutes
      .filter((route) => !inventoryScreens.has(route.pattern))
      .map((route) => route.pattern),
    'Manifest screens must exist in the filesystem inventory',
  ).toEqual([]);

  const viewport = resolveAuditViewport(process.env.E2E_UI_AUDIT_VIEWPORT);
  const personas = selectedPersonaIds(process.env);
  const namespace = process.env.E2E_UI_AUDIT_NAMESPACE ?? 'ui-audit-v1';
  const fixtureRows = captureFixtures();
  const plan = (
    await resolveCaptureMatrix(selectedRoutes, {
      namespace,
    })
  )
    .filter((entry) => personas.includes(entry.persona) && entry.viewport === viewport.class)
    .sort((left, right) =>
      [left.persona, left.routeId, left.state]
        .join(':')
        .localeCompare([right.persona, right.routeId, right.state].join(':')),
    );

  const auditTheme = resolveAuditTheme(process.env.E2E_UI_AUDIT_THEME);
  const themeId = auditTheme?.id ?? 'account-default';
  const pointer = process.env.E2E_UI_AUDIT_POINTER === 'coarse' ? 'coarse' : 'fine';
  const certificationEnabled = process.env.E2E_UI_AUDIT_CERTIFY === '1';
  const runId = safeSegment(
    process.env.E2E_UI_AUDIT_RUN_ID ??
      `${new Date().toISOString()}--${viewport.id}--${themeId}--${pointer}`,
  );
  const artifact: CaptureRunArtifact = {
    schemaVersion: 3,
    runId,
    startedAt: new Date().toISOString(),
    appCommit: inventory.baseCommit,
    fixtureVersion: process.env.E2E_UI_AUDIT_FIXTURE_VERSION ?? 'unversioned',
    namespace,
    exactViewport: viewport,
    theme: themeId,
    project: testInfo.project.name,
    pointer,
    certificationEnabled,
    routeFilter: [...filter],
    results: [],
    summary: summarizeResults(plan.length, []),
  };
  let artifactPath = writeRunArtifact(outputDir, artifact);
  const persist = () => {
    artifact.summary = summarizeResults(plan.length, artifact.results);
    artifactPath = writeRunArtifact(outputDir, artifact);
  };
  const scenarioHooks = new CaptureScenarioHooks(page.request);
  const routesById = new Map(selectedRoutes.map((route) => [route.id, route] as const));
  const appOrigin = new URL(
    (testInfo.project.use.baseURL as string | undefined) ?? 'http://localhost:5173',
  ).origin;
  let activePersona: CapturePersona['id'] | undefined;
  let activePersonaBlocker: string | undefined;
  let previousTheme: Awaited<ReturnType<typeof prepareAuditTheme>>;

  try {
    for (const entry of plan) {
      const route = routesById.get(entry.routeId);
      if (!route) throw new Error(`Capture plan references unknown route ${entry.routeId}.`);
      if (entry.persona !== activePersona) {
        if (auditTheme && activePersona && activePersona !== 'anonymous') {
          await restoreAuditTheme(page, previousTheme);
        }
        activePersona = entry.persona;
        activePersonaBlocker = await authenticate(page, capturePersona(entry.persona));
        previousTheme = undefined;
        if (!activePersonaBlocker && auditTheme) {
          if (entry.persona === 'anonymous') await prepareAnonymousAuditTheme(page, auditTheme);
          else previousTheme = await prepareAuditTheme(page, auditTheme);
        }
      }

      const result: CaptureRunResult = {
        scenarioKey: entry.scenarioKey,
        routeId: entry.routeId,
        pattern: entry.pattern,
        persona: entry.persona,
        viewportClass: entry.viewport,
        state: entry.state,
        outcome: 'blocked-auth',
      };
      if (activePersonaBlocker) {
        result.blockReason = activePersonaBlocker;
        artifact.results.push(result);
        persist();
        continue;
      }

      let preparationAttempted = false;
      try {
        preparationAttempted = true;
        const url = await prepareCapturePlanEntry(route, entry, {
          namespace,
          provisionFixture: async (fixture) => {
            const provisioned = resolveFixtureProvision(fixture.id, fixtureRows);
            if (!provisioned) throw new MissingCaptureFixtureError(fixture.id);
            return provisioned;
          },
          prepareState: async (scenario) => scenarioHooks.prepare(scenario),
          resetState: async (scenario) => scenarioHooks.reset(scenario),
        });
        result.resolvedUrl = url;
        result.preparation = scenarioHooks.preparationFor(entry);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({
          reducedMotion: process.env.E2E_UI_AUDIT_MOTION === 'reduced' ? 'reduce' : 'no-preference',
        });
        const events = captureEvents(page, appOrigin);
        try {
          const navigation = await navigateToCaptureRoute(page, url, route);
          const { response } = navigation;
          events.discardRecoveredViteOptimizeDeps(navigation.recoveredOutdatedOptimizeDepUrls);
          result.finalUrl = page.url();
          result.status = response?.status() ?? null;
          const expectedPath = new URL(url, appOrigin).pathname;
          const finalPath = new URL(page.url()).pathname;
          if (
            /\/(login|onboarding)(?:\/|$)/.test(finalPath) &&
            !expectedPath.startsWith(finalPath)
          ) {
            result.outcome = 'auth-or-onboarding-redirect';
          } else {
            const requireSingleVisibleTitle = requiresSingleVisibleTitle(route.archetype);
            const diagnosticOptions: RuntimeUiDiagnosticOptions = {
              requireSingleVisibleTitle,
              minimumInteractiveTargetPx: pointer === 'coarse' ? 44 : 24,
              enforceInteractiveTargetSize: pointer === 'coarse',
            };
            result.diagnostics = await collectRuntimeUiDiagnostics(page, diagnosticOptions);
            assertCriticalRuntimeDiagnostics(result.diagnostics, route.id, diagnosticOptions);
            await assertCaptureContentReady(page, route);
            if (certificationEnabled) {
              result.certification = await runRouteCertification(
                page,
                route,
                { width: viewport.width, height: viewport.height },
                pointer,
              );
              await page.emulateMedia({
                reducedMotion:
                  process.env.E2E_UI_AUDIT_MOTION === 'reduced' ? 'reduce' : 'no-preference',
              });
            }
            const screenshot = path.join(
              outputDir,
              `${runId}--${safeSegment(entry.scenarioKey)}.png`,
            );
            const screenshotBytes = await page.screenshot({ path: screenshot, fullPage: true });
            await assertScreenshotHasVisualDiversity(page, screenshotBytes, route.id);
            result.screenshot = path.relative(process.cwd(), screenshot);
            result.outcome = 'captured';
          }
        } finally {
          result.consoleErrors = events.consoleErrors;
          result.pageErrors = events.pageErrors;
          result.networkFailures = events.networkFailures;
          result.failedSameOriginGets = events.failedSameOriginGets;
          events.stop();
        }
        const runtimeFailures = [
          ...(result.consoleErrors ?? []).map((value) => `console: ${value}`),
          ...(result.pageErrors ?? []).map((value) => `page: ${value}`),
          ...(result.failedSameOriginGets ?? []).map((value) => `GET: ${value}`),
        ];
        if (runtimeFailures.length > 0) {
          result.outcome = 'failed';
          result.failures = runtimeFailures;
        }
      } catch (error) {
        if (error instanceof CaptureScenarioBlockedError) {
          result.outcome = 'blocked-state';
          result.preparation = error.preparation;
          result.blockReason = error.message;
        } else if (error instanceof MissingCaptureFixtureError) {
          result.outcome = 'blocked-fixture';
          result.blockReason = error.message;
        } else {
          result.outcome = 'failed';
          result.failures = [error instanceof Error ? error.message : String(error)];
        }
      } finally {
        if (preparationAttempted) {
          try {
            await resetCapturePlanEntry(
              route,
              {
                namespace,
                resetState: async (scenario) => scenarioHooks.reset(scenario),
                resetFixture: async () => undefined,
              },
              entry,
            );
          } catch (error) {
            result.outcome = 'failed';
            result.failures = [
              ...(result.failures ?? []),
              `reset: ${error instanceof Error ? error.message : String(error)}`,
            ];
          }
        }
        artifact.results.push(result);
        persist();
      }
    }

    if (filter.size === 0) {
      for (const route of REDIRECT_DESIGN_MANIFEST) {
        const inventoryRoute = inventory.routes.find(
          (candidate) => candidate.kind === 'redirect' && candidate.pattern === route.pattern,
        );
        const contract = inventoryRoute?.redirectContract;
        expect(contract, `${route.pattern} is missing a redirect contract`).toBeTruthy();
        const response = await page.request.get(contract!.probePath, { maxRedirects: 0 });
        const status = response.status();
        expect(contract!.statuses, `${route.pattern} returned ${status}`).toContain(status);
      }
    }
  } finally {
    if (auditTheme && activePersona && activePersona !== 'anonymous' && !activePersonaBlocker) {
      await restoreAuditTheme(page, previousTheme);
    }
    artifact.completedAt = new Date().toISOString();
    persist();
    await attachRunArtifact(testInfo, artifactPath);
  }

  const incomplete = artifact.results.filter(
    (result) => result.outcome !== 'captured' && result.outcome !== 'blocked-state',
  );
  const blocked = artifact.results.filter((result) => result.outcome.startsWith('blocked-'));
  if (
    artifact.summary.captured === 0 &&
    artifact.summary.failed === 0 &&
    blocked.length === artifact.results.length
  ) {
    testInfo.annotations.push({
      type: 'blocked',
      description: `${blocked.length} scenarios blocked; see ${path.relative(process.cwd(), artifactPath)}.`,
    });
    test.skip(true, 'Disposable authentication/fixture prerequisites are unavailable.');
  }
  expect(
    incomplete,
    'Certification contains failed, auth-blocked, or fixture-blocked scenarios',
  ).toEqual([]);
  if (process.env.E2E_UI_AUDIT_ALLOW_BLOCKED !== '1') {
    expect(blocked, 'State preparation blockers require a disposable scenario provider').toEqual(
      [],
    );
  }
});
