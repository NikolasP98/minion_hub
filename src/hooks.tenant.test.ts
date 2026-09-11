import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  globalOrg: vi.fn(),
  db: vi.fn(),
  upsert: vi.fn(),
  writeCap: vi.fn(),
  hasCap: vi.fn(),
}));
vi.mock('$server/env-hoist', () => ({}));
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
vi.mock('$lib/server/posthog', () => ({ getPostHogClient: async () => null }));
vi.mock('$lib/server/cache', () => ({
  initCache: async () => {},
  initCacheDataPlane: async () => {},
}));
vi.mock('$server/auth/resolve-identity', () => ({ resolveIdentity: mocks.identity }));
vi.mock('$server/db/client', () => ({ getDb: mocks.db }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn() }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: () => ({ from: mocks.globalOrg }) }));
vi.mock('$server/services/server.service', () => ({ upsertServer: mocks.upsert }));
vi.mock('$server/services/hosts.service', () => ({ loadHostsForUser: vi.fn() }));
vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: async () => {},
  SsrfBlockedError: class extends Error {},
}));
vi.mock('$server/services/rbac.service', () => ({
  apiWriteCapability: mocks.writeCap,
  hasOrgCapability: mocks.hasCap,
}));
vi.mock('$server/services/modules.service', () => ({ listModuleStates: async () => ({}) }));
vi.mock('$lib/server/workforce-identity', () => ({ mintWorkforceIdentity: vi.fn() }));
vi.mock('$lib/server/workforce-viewer', () => ({ trustedWorkforceViewerRoleKeys: vi.fn() }));
vi.mock('$server/services/user-preferences.service', () => ({
  getUserPreferences: async () => ({}),
}));
vi.mock('$server/ai-usage', () => ({
  runWithAiUsageScope: (_scope: unknown, fn: () => unknown) => fn(),
  setAiUsageOrg: vi.fn(),
}));
vi.mock('$server/services/gateway.pg.service', () => ({
  isGatewayChannel: (channel: string) => ['prd', 'dev'].includes(channel),
}));

import { handle } from './hooks.server';

// SvelteKit's real sequence requires the request store normally opened by its server.
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
import { POST } from './routes/api/servers/+server';

const user = {
  id: 'synthetic-user',
  supabaseId: 'synthetic-profile',
  email: 'synthetic@example.test',
  displayName: null,
  role: 'user' as const,
};
const ctx = { db: {} as never, tenantId: 'member-org' };
function event(path: string, method = 'POST'): RequestEvent {
  const url = new URL(path, 'https://hub.test');
  return {
    url,
    request: new Request(url, {
      method,
      ...(method === 'POST'
        ? {
            body: JSON.stringify({
              name: 'Gateway',
              url: 'wss://gateway.test',
              token: 'synthetic',
            }),
          }
        : {}),
    }),
    locals: {},
    route: { id: path },
    cookies: { get: () => undefined },
  } as unknown as RequestEvent;
}
async function post(path = '/api/servers') {
  return runHook({ event: event(path), resolve: async (ev) => POST(ev) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ locals: { user }, bypassGate: false });
  mocks.db.mockReturnValue({});
  mocks.globalOrg.mockReturnValue({
    select: () => ({
      limit: () => ({ maybeSingle: async () => ({ data: { id: 'unrelated-global-org' } }) }),
    }),
  });
  mocks.upsert.mockResolvedValue('synthetic-server');
  mocks.writeCap.mockReturnValue(null);
  mocks.hasCap.mockResolvedValue(false);
});

describe('identity output through the actual hook and server POST', () => {
  it.each(['user', 'admin'] as const)(
    'denies verified %s without a tenant before persistence',
    async (role) => {
      mocks.identity.mockResolvedValue({ locals: { user: { ...user, role } }, bypassGate: false });
      await expect(post()).rejects.toMatchObject({ status: 403 });
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.globalOrg).not.toHaveBeenCalled();
    },
  );
  it('denies a localized no-tenant server mutation', async () => {
    await expect(post('/es/api/servers')).rejects.toMatchObject({ status: 403 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each(['user', 'admin'] as const)('preserves explicit resolved tenant for %s', async (role) => {
    mocks.identity.mockResolvedValue({
      locals: { user: { ...user, role }, tenantCtx: ctx },
      bypassGate: false,
    });
    expect((await post()).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(ctx, expect.any(Object), user.id);
    expect(mocks.globalOrg).not.toHaveBeenCalled();
  });
  it('preserves anonymous server authentication denial without tenant lookup', async () => {
    mocks.identity.mockResolvedValue({ locals: {}, bypassGate: false });
    await expect(post()).rejects.toMatchObject({ status: 401 });
    expect(mocks.globalOrg).not.toHaveBeenCalled();
  });
  it.each([
    '/join',
    '/join?token=synthetic',
    '/api/join-requests',
    '/api/registry/catalog',
    '/api/marketplace/agents',
    '/api/internal/synthetic',
    '/api/jobs/tick',
    '/api/auth/password-login',
  ])('dispatches %s without inventing authority', async (path) => {
    const resolve = vi.fn(async (ev: RequestEvent) => {
      expect(ev.locals.tenantCtx).toBeUndefined();
      return new Response('handler-owned authorization');
    });
    expect((await runHook({ event: event(path), resolve })).status).toBe(200);
    expect(resolve).toHaveBeenCalledOnce();
    expect(mocks.globalOrg).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])(
    'preserves %s invite enrollment dispatch without a tenant',
    async (method) => {
      const resolve = vi.fn(async (ev: RequestEvent) => {
        expect(ev.locals.tenantCtx).toBeUndefined();
        return new Response('invite-handler');
      });
      expect(
        (await runHook({ event: event('/join?token=synthetic', method), resolve })).status,
      ).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
      expect(mocks.globalOrg).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'denies unexempted no-tenant API (authenticated=%s)',
    async (authenticated) => {
      mocks.identity.mockResolvedValue({
        locals: authenticated ? { user } : {},
        bypassGate: false,
      });
      const resolve = vi.fn();
      const response = await runHook({ event: event('/api/crm/contacts'), resolve });
      expect(response.status).toBe(authenticated ? 403 : 401);
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  // Adversarial regression for 09-SOURCE-VERIFICATION.md SV-01 on the merged
  // tree (master's #208/#210 hooks + the 09-03 controls): the strongest caller —
  // a verified ADMIN carrying an orgId hint for someone else's organization but
  // no resolved membership — must be refused rather than handed authority over
  // the org it named (or over the first global organization the old fallback
  // would have selected).
  it('refuses an admin with a foreign orgId hint and no membership', async () => {
    mocks.identity.mockResolvedValue({
      locals: { user: { ...user, role: 'admin' }, orgId: 'victim-org' },
      bypassGate: false,
    });
    const seen: RequestEvent[] = [];
    await expect(
      runHook({
        event: event('/api/servers'),
        resolve: async (ev) => {
          seen.push(ev);
          return POST(ev);
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    // No fabricated tenant reached the handler, from the hint or from a lookup.
    for (const ev of seen) expect(ev.locals.tenantCtx).toBeUndefined();
    expect(mocks.globalOrg).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('keeps the write capability gate for a resolved tenant', async () => {
    mocks.identity.mockResolvedValue({ locals: { user, tenantCtx: ctx }, bypassGate: false });
    mocks.writeCap.mockReturnValue({ module: 'crm', action: 'create' });
    const resolve = vi.fn();
    expect((await runHook({ event: event('/api/crm/contacts'), resolve })).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
    expect(mocks.hasCap).toHaveBeenCalled();
  });
});
