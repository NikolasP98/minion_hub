import { describe, expect, it, vi } from 'vitest';
import {
  prepareCapturePlanEntry,
  resolveCaptureMatrix,
  resetCapturePlanEntry,
} from './capture-route-resolver';
import { CAPTURE_FIXTURE_IDS } from './capture-fixtures';
import { COMPONENT_DESIGN_REGISTRY } from './component-design-registry';
import { PUBLIC_ROUTE_PATTERNS } from './route-access-policies';
import {
  REDIRECT_DESIGN_MANIFEST,
  ROUTE_DESIGN_MANIFEST,
  SCREEN_DESIGN_MANIFEST,
} from './route-design-manifest';
import {
  ROUTE_CONTRACT_EXPECTATIONS,
  validateComponentDesignRegistry,
  validateFilesystemRouteCoverage,
  validateNavReferences,
  validateRedirectSourceContracts,
  validateRouteDesignManifest,
} from './route-design-validation';
import {
  buildComponentContractSnapshot,
  discoverNavReferences,
  discoverPageEndpoints,
  discoverRedirectSources,
} from '$server/ui-audit/route-contract-filesystem';

const projectRoot = process.cwd();

describe('route design contracts', () => {
  it('covers the complete filesystem inventory with valid metadata', () => {
    const endpoints = discoverPageEndpoints(projectRoot);
    expect(endpoints).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.endpoints);
    expect(ROUTE_DESIGN_MANIFEST).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.endpoints);
    expect(SCREEN_DESIGN_MANIFEST).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.screens);
    expect(REDIRECT_DESIGN_MANIFEST).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.redirects);
    expect(CAPTURE_FIXTURE_IDS).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.fixtures);
    expect(validateRouteDesignManifest()).toEqual([]);
    expect(validateFilesystemRouteCoverage(endpoints.map((endpoint) => endpoint.pattern))).toEqual(
      [],
    );
  });

  it('detects filesystem routes that are not registered', () => {
    const patterns = discoverPageEndpoints(projectRoot).map((endpoint) => endpoint.pattern);
    const issues = validateFilesystemRouteCoverage([...patterns, '/audit/unregistered']);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'filesystem.unregistered', subject: '/audit/unregistered' }),
    );
  });

  it('assigns every endpoint to one complete Phase 5 migration wave', () => {
    const counts = ROUTE_DESIGN_MANIFEST.reduce<Record<string, number>>((output, route) => {
      output[route.migrationWave] = (output[route.migrationWave] ?? 0) + 1;
      return output;
    }, {});
    expect(counts).toEqual({ A: 30, B: 67, C: 16, D: 23, E: 10 });
    expect(
      ROUTE_DESIGN_MANIFEST.find((route) => route.pattern === '/memberships')?.migrationWave,
    ).toBe('B');
    expect(
      ROUTE_DESIGN_MANIFEST.find((route) => route.pattern === '/workshop/[...path]')?.migrationWave,
    ).toBe('D');
    expect(
      ROUTE_DESIGN_MANIFEST.find((route) => route.pattern === '/plugins/[id]')?.migrationWave,
    ).toBe('D');
  });

  it('keeps redirect status, target and preservation behavior aligned with source', () => {
    const sources = discoverRedirectSources(projectRoot, REDIRECT_DESIGN_MANIFEST);
    expect(sources).toHaveLength(ROUTE_CONTRACT_EXPECTATIONS.redirects);
    expect(validateRedirectSourceContracts(sources)).toEqual([]);
  });

  it('keeps public routes on applicable state sets instead of a universal superset', () => {
    const expected: Readonly<Record<string, readonly string[]>> = {
      '/auth/reset': [
        'default',
        'validation-error',
        'submitting',
        'success',
        'expired',
        'recoverable-error',
      ],
      '/book/[slug]': [
        'default',
        'loading',
        'empty',
        'submitting',
        'success',
        'not-found',
        'recoverable-error',
      ],
      '/invite/accept': ['default'],
      '/join': ['default', 'validation-error', 'submitting', 'recoverable-error'],
      '/join/sent': ['complete'],
      '/link/[code]': ['default', 'submitting', 'success', 'expired', 'recoverable-error'],
      '/login': ['default', 'validation-error', 'submitting', 'recoverable-error'],
      '/login/forgot': ['default', 'validation-error', 'submitting', 'success'],
      '/onboarding': ['default', 'validation-error', 'submitting', 'recoverable-error'],
      '/onboarding/complete': ['complete'],
    };
    for (const [pattern, states] of Object.entries(expected)) {
      const route = SCREEN_DESIGN_MANIFEST.find((candidate) => candidate.pattern === pattern);
      expect(route?.capture.states, pattern).toEqual(states);
    }
  });

  it('distinguishes unprotected pages from authenticated auth/onboarding screens', () => {
    expect([...PUBLIC_ROUTE_PATTERNS].sort()).toEqual([
      '/auth/reset',
      '/book/[slug]',
      '/invite/accept',
      '/login',
      '/login/forgot',
    ]);
    for (const pattern of [
      '/join',
      '/join/sent',
      '/link/[code]',
      '/onboarding',
      '/onboarding/complete',
    ]) {
      const route = SCREEN_DESIGN_MANIFEST.find((candidate) => candidate.pattern === pattern);
      expect(route?.accessPolicyId, pattern).not.toBe('public');
    }
  });

  it('limits owner-filtered and destructive states to routes that can render them', () => {
    const ownerFiltered = SCREEN_DESIGN_MANIFEST.filter((route) =>
      route.capture.states.includes('owner-filtered'),
    ).map((route) => route.pattern);
    expect(ownerFiltered.sort()).toEqual(['/crm/[contactId]', '/sales/[id]', '/support/[id]']);

    const destructive = SCREEN_DESIGN_MANIFEST.filter((route) =>
      route.capture.states.includes('destructive-confirm'),
    ).map((route) => route.pattern);
    expect(destructive.sort()).toEqual([
      '/brains/[id]',
      '/crm/[contactId]',
      '/stock/entries/[id]',
    ]);
  });

  it('builds a capture plan without pretending state fixtures have been prepared', async () => {
    const route = SCREEN_DESIGN_MANIFEST.find((candidate) => candidate.pattern === '/tools/[id]');
    expect(route).toBeDefined();
    if (!route) return;
    const provisionFixture = vi.fn();
    const plan = await resolveCaptureMatrix([route], {
      namespace: 'route-contract-test',
      provisionFixture,
    });
    expect(provisionFixture).not.toHaveBeenCalled();
    expect(new Set(plan.map((entry) => entry.scenarioKey)).size).toBe(plan.length);

    const prepareState = vi.fn();
    const url = await prepareCapturePlanEntry(route, plan[0], {
      namespace: 'route-contract-test',
      provisionFixture,
      prepareState,
    });
    expect(url).toContain('/tools/audit-gateway-tool');
    expect(provisionFixture).toHaveBeenCalledOnce();
    expect(prepareState).toHaveBeenCalledWith(expect.objectContaining({ url }));
  });

  it('runs fixture reset hooks after a capture entry', async () => {
    const route = SCREEN_DESIGN_MANIFEST.find((candidate) => candidate.pattern === '/tools/[id]');
    expect(route).toBeDefined();
    if (!route) return;
    const plan = await resolveCaptureMatrix([route], { namespace: 'route-contract-test' });
    const resetFixture = vi.fn();
    const resetState = vi.fn();
    await resetCapturePlanEntry(
      route,
      { namespace: 'route-contract-test', resetFixture, resetState },
      plan[0],
    );
    expect(resetState).toHaveBeenCalledWith(plan[0]);
    expect(resetFixture).toHaveBeenCalledOnce();
  });

  it('resolves static and templated navigation hrefs through the route contract', () => {
    const references = discoverNavReferences(projectRoot);
    expect(references.length).toBeGreaterThan(30);
    expect(references).toContainEqual(expect.objectContaining({ href: '/plugins/[dynamic]' }));
    expect(validateNavReferences(references)).toEqual([]);
  });
});

describe('component design contracts', () => {
  it('resolves every component and matches declared variant unions', () => {
    const snapshot = buildComponentContractSnapshot(projectRoot, COMPONENT_DESIGN_REGISTRY);
    expect(validateComponentDesignRegistry(snapshot)).toEqual([]);
  });

  it('detects source/metadata variant drift', () => {
    const snapshot = buildComponentContractSnapshot(projectRoot, COMPONENT_DESIGN_REGISTRY);
    const drifted = COMPONENT_DESIGN_REGISTRY.map((entry) =>
      entry.codeId === 'primitive.button'
        ? { ...entry, variants: { ...entry.variants, variant: ['primary'] } }
        : entry,
    );
    expect(validateComponentDesignRegistry(snapshot, drifted)).toContainEqual(
      expect.objectContaining({ code: 'component.contract-drift', subject: 'primitive.button' }),
    );
  });
});
