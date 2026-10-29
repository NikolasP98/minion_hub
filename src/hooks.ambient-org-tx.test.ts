import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { currentAmbientOrgTx } from '$server/db/ambient-org-tx';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('$server/env-hoist', () => ({}));
vi.mock('$env/dynamic/private', () => ({ env: {} as Record<string, string> }));
vi.mock('@sentry/sveltekit', () => ({
  init: vi.fn(),
  sentryHandle:
    () =>
    ({ event, resolve }: Parameters<Handle>[0]) =>
      resolve(event),
  handleErrorWithSentry: (handler: unknown) => handler,
}));
vi.mock('$lib/i18n', () => ({
  i18n: {
    handle:
      () =>
      ({ event, resolve }: Parameters<Handle>[0]) =>
        resolve(event),
  },
}));
vi.mock('$lib/server/posthog', () => ({
  getPostHogClient: async () => null,
  captureServerEvent: vi.fn(),
}));
vi.mock('$lib/server/cache', () => ({
  initCache: async () => {},
  initCacheDataPlane: async () => {},
}));
vi.mock('$server/auth/resolve-identity', () => ({ resolveIdentity: mocks.identity }));
vi.mock('$server/db/client', () => ({ getDb: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({}),
  getOrgTransactionDb: () => ({ transaction: mocks.transaction }),
}));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from: vi.fn() }) }));
vi.mock('$server/services/server.service', () => ({ upsertServer: vi.fn() }));
vi.mock('$server/services/hosts.service', () => ({ loadHostsForUser: vi.fn() }));
vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: async () => {},
  SsrfBlockedError: class extends Error {},
}));
vi.mock('$server/services/rbac.service', () => ({
  apiWriteCapability: () => null,
  hasOrgCapability: async () => true,
}));
vi.mock('$server/services/modules.service', () => ({ listModuleStates: async () => ({}) }));
// The route/module guards are not under test here; they own their own suites.
vi.mock('$lib/modules/route-guard', () => ({
  shouldApplyOrganizationRouteGuards: () => false,
  isAppRouteBlocked: () => false,
}));
vi.mock('$lib/server/workforce-identity', () => ({ mintWorkforceIdentity: vi.fn() }));
vi.mock('$lib/server/workforce-viewer', () => ({ trustedWorkforceViewerRoleKeys: vi.fn() }));
vi.mock('$server/services/user-preferences.service', () => ({
  getUserPreferences: async () => ({}),
}));
vi.mock('$server/ai-usage', () => ({
  runWithAiUsageScope: (_scope: unknown, fn: () => unknown) => fn(),
  setAiUsageOrg: vi.fn(),
  markAiUsageAuthenticated: vi.fn(),
}));
vi.mock('$server/services/gateway.pg.service', () => ({
  isGatewayChannel: (channel: string) => ['prd', 'dev'].includes(channel),
}));

import { handle } from './hooks.server';

const kitRuntimePath = '@sveltejs/kit/internal/server';
const kitRuntime = (await import(kitRuntimePath)) as {
  with_request_store: <T>(store: unknown, fn: () => T) => T;
};
function runHook(input: Parameters<Handle>[0]) {
  return kitRuntime.with_request_store(
    {
      event: input.event,
      state: {
        tracing: { record_span: ({ fn }: { fn: (span: undefined) => unknown }) => fn(undefined) },
      },
    },
    () => handle(input),
  );
}

const user = {
  id: 'synthetic-user',
  supabaseId: 'synthetic-profile',
  email: 'synthetic@example.test',
  displayName: null,
  role: 'owner' as const,
};

function event(routeId: string, pathname: string, method = 'GET'): RequestEvent {
  const url = new URL(pathname, 'https://hub.test');
  return {
    url,
    request: new Request(url, { method }),
    locals: {},
    route: { id: routeId },
    cookies: { get: () => undefined },
    setHeaders: vi.fn(),
  } as unknown as RequestEvent;
}

/** A drizzle-ish transaction: hands the callback a tx that answers set_config. */
function fakeTransaction() {
  const tx = { execute: vi.fn(async () => []), rollback: vi.fn() };
  const impl = async (fn: (t: unknown) => Promise<unknown>) => fn(tx);
  mocks.transaction.mockImplementation(impl);
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    locals: { user, tenantCtx: { db: {} as never, tenantId: 'org-a' } },
    bypassGate: false,
  });
});

describe('ambientOrgTxHandle', () => {
  it('shares ONE scoped transaction for a POS page-data GET', async () => {
    const tx = fakeTransaction();
    let ambient: ReturnType<typeof currentAmbientOrgTx>;
    const response = await runHook({
      event: event('/(app)/pos/sell', '/pos/sell'),
      resolve: async () => {
        ambient = currentAmbientOrgTx();
        return new Response('page data');
      },
    });

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(ambient).toMatchObject({
      tenantId: 'org-a',
      profileId: 'synthetic-profile',
      poisoned: false,
    });
    // The one setup statement `withOrgCore` would otherwise run per call.
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(tx.rollback).not.toHaveBeenCalled();
  });

  it('shares it for a /api/pos GET endpoint too', async () => {
    fakeTransaction();
    await runHook({
      event: event('/api/pos/tickets', '/api/pos/tickets'),
      resolve: async () => {
        expect(currentAmbientOrgTx()).toBeDefined();
        return new Response('{}');
      },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it.each([
    ['a POS write', '/(app)/pos/sell', '/pos/sell', 'POST'],
    ['a non-POS GET', '/(app)/home', '/home', 'GET'],
    ['a non-POS API GET', '/api/crm/parties', '/api/crm/parties', 'GET'],
  ])('opens no shared transaction for %s', async (_label, routeId, pathname, method) => {
    fakeTransaction();
    const response = await runHook({
      event: event(routeId, pathname, method),
      resolve: async () => {
        expect(currentAmbientOrgTx()).toBeUndefined();
        return new Response('ok');
      },
    });
    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('opens none for an anonymous request (no resolved tenant)', async () => {
    fakeTransaction();
    mocks.identity.mockResolvedValue({ locals: { user }, bypassGate: false });
    await runHook({
      event: event('/(app)/pos/sell', '/pos/sell'),
      resolve: async () => {
        expect(currentAmbientOrgTx()).toBeUndefined();
        return new Response('ok');
      },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rolls a poisoned shared transaction back but still serves the response', async () => {
    const tx = fakeTransaction();
    const rollback = new Error('rollback');
    tx.rollback.mockImplementation(() => {
      throw rollback;
    });
    mocks.transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
      // postgres.js rejects the transaction after rollback; the response must survive.
      await fn(tx);
    });

    const response = await runHook({
      event: event('/(app)/pos/sell', '/pos/sell'),
      resolve: async () => {
        const ambient = currentAmbientOrgTx();
        if (ambient) ambient.poisoned = true;
        return new Response('served anyway');
      },
    });

    expect(await response.text()).toBe('served anyway');
    expect(tx.rollback).toHaveBeenCalledOnce();
  });
});
