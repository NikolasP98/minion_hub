import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Handle, RequestEvent } from '@sveltejs/kit';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  globalOrg: vi.fn(),
  db: vi.fn(),
  upsert: vi.fn(),
  writeCap: vi.fn(),
  hasCap: vi.fn(),
  cronEnv: { CRON_SECRET: 'synthetic-marketplace-cron' } as Record<string, string>,
  marketplaceSync: vi.fn(),
  navConfig: vi.fn(),
  perms: vi.fn(),
  explicit: vi.fn(),
  moduleStates: vi.fn(),
  enforced: { list: [] as string[] },
}));
vi.mock('$server/env-hoist', () => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mocks.cronEnv }));
vi.mock('$server/services/marketplace.service', () => ({
  syncMarketplaceAgents: mocks.marketplaceSync,
}));
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
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: vi.fn(),
  // ambientOrgTxHandle's handle — never reached here (no POS GET in this suite).
  getOrgTransactionDb: vi.fn(),
}));
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
  resolveCapabilities: async () => ({ explicitView: mocks.explicit }),
}));
vi.mock('$server/services/nav-config.service', () => ({ readNavConfig: mocks.navConfig }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => ({ tenantId: 'member-org' }) }));
vi.mock('$server/services/permissions.service', () => ({
  loadPermissionsForUser: async () => ({ permissions: mocks.perms(), roles: [] }),
}));
vi.mock('$lib/permissions', async (orig) => ({
  ...(await orig<typeof import('$lib/permissions')>()),
  get DATASET_ENFORCED() {
    return mocks.enforced.list;
  },
}));
vi.mock('$server/services/modules.service', () => ({
  listModuleStates: async () => mocks.moduleStates(),
}));
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
import { GET as marketplaceTick } from './routes/api/marketplace/sync/tick/+server';
import { POST as marketplaceManualSync } from './routes/api/marketplace/sync/+server';

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
    setHeaders: vi.fn(),
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
  mocks.moduleStates.mockReturnValue({});
  mocks.perms.mockReturnValue([]);
  mocks.explicit.mockReturnValue(undefined);
  mocks.enforced.list = [];
  mocks.navConfig.mockResolvedValue({
    version: 1,
    sections: [
      {
        id: 'sec001',
        slug: 'staff',
        label: 'Staff',
        pages: [{ id: 'k3x9q2', slug: 'sell', label: 'Sell', kind: 'link', target: '/pos/sell' }],
      },
    ],
    builtinSections: {
      appointments: [
        { id: 'a1b2c3', slug: 'new', label: 'New', kind: 'main', target: '/appointments' },
      ],
    },
    builtin: {},
  });
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
    '/api/active-org',
    '/api/registry/catalog',
    '/api/marketplace/agents',
    '/api/internal/synthetic',
    '/api/jobs/tick',
    '/api/scheduling/public/acme-clinic/slots',
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
  it('does not exempt descendants of the organization switch endpoint', async () => {
    const resolve = vi.fn();
    const response = await runHook({ event: event('/api/active-org/unregistered'), resolve });
    expect(response.status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

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

  it.each([
    ['/api/scheduling/links', false],
    ['/api/scheduling/links', true],
    ['/api/scheduling/event-types', false],
    ['/api/scheduling/event-types', true],
  ] as const)(
    'uses the real collection POST edit mapping for %s (edit=%s)',
    async (path, hasEdit) => {
      const actual = await vi.importActual<typeof import('$server/services/rbac.service')>(
        '$server/services/rbac.service',
      );
      mocks.writeCap.mockImplementation(actual.apiWriteCapability);
      mocks.identity.mockResolvedValue({ locals: { user, tenantCtx: ctx }, bypassGate: false });
      mocks.hasCap.mockImplementation(
        async (_locals: unknown, module: string, action: string) =>
          module === 'scheduling' &&
          (action === 'edit' ? hasEdit : ['manage', 'create'].includes(action)),
      );
      const resolve = vi.fn(async () => new Response('accepted by central hook'));
      const response = await runHook({ event: event(path), resolve });
      expect(response.status).toBe(hasEdit ? 200 : 403);
      expect(resolve).toHaveBeenCalledTimes(hasEdit ? 1 : 0);
      expect(mocks.hasCap).toHaveBeenCalledWith(expect.anything(), 'scheduling', 'edit');
    },
  );

  it('passes the write gate when the role holds an anyOf alternative', async () => {
    mocks.identity.mockResolvedValue({ locals: { user, tenantCtx: ctx }, bypassGate: false });
    mocks.writeCap.mockReturnValue({
      module: 'crm',
      action: 'create',
      anyOf: [{ module: 'pos', action: 'create' }],
    });
    mocks.hasCap.mockImplementation(async (_l: unknown, module: string) => module === 'pos');
    const resolve = vi.fn(async () => new Response('ok'));
    expect((await runHook({ event: event('/api/crm/parties'), resolve })).status).toBe(200);
    expect(resolve).toHaveBeenCalled();
    expect(mocks.hasCap).toHaveBeenCalledWith(expect.anything(), 'crm', 'create');
    expect(mocks.hasCap).toHaveBeenCalledWith(expect.anything(), 'pos', 'create');
  });
});

describe('marketplace cron through the real application hook', () => {
  it.each([undefined, 'Bearer wrong', 'Bearer synthetic-marketplace-cron'])(
    'reaches its own bearer guard without session or tenant (%s)',
    async (authorization) => {
      mocks.identity.mockResolvedValue({ locals: {}, bypassGate: false });
      mocks.marketplaceSync.mockResolvedValue({
        status: 'not_due',
        synced: 0,
        failed: 0,
        errors: [],
        continuation: false,
      });
      const input = event('/api/marketplace/sync/tick', 'GET');
      if (authorization) input.request.headers.set('authorization', authorization);
      const resolve = vi.fn(async (ev: RequestEvent) => marketplaceTick(ev));
      const result = runHook({ event: input, resolve });
      if (authorization === 'Bearer synthetic-marketplace-cron') {
        expect((await result).status).toBe(200);
        expect(mocks.marketplaceSync).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toMatchObject({ status: 401 });
        expect(mocks.marketplaceSync).not.toHaveBeenCalled();
      }
      expect(resolve).toHaveBeenCalledOnce();
      expect(mocks.globalOrg).not.toHaveBeenCalled();
    },
  );
  it('preserves the manual sync handler authentication through public marketplace dispatch', async () => {
    mocks.identity.mockResolvedValue({ locals: {}, bypassGate: false });
    const resolve = vi.fn(async (ev: RequestEvent) => marketplaceManualSync(ev));
    await expect(runHook({ event: event('/api/marketplace/sync'), resolve })).rejects.toMatchObject(
      { status: 401 },
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(mocks.marketplaceSync).not.toHaveBeenCalled();
  });
});

describe('plan operation cache and central capability boundaries', () => {
  const operationId = '60000000-0000-4000-8000-000000000001';
  it.each([false, true])(
    'marks early identity denial private and no-store (authenticated=%s)',
    async (authenticated) => {
      mocks.identity.mockResolvedValue({
        locals: authenticated ? { user } : {},
        bypassGate: false,
      });
      const input = event(`/api/pos/plans/operations/${operationId}`, 'GET');
      const resolve = vi.fn();
      const response = await runHook({ event: input, resolve });
      expect(response.status).toBe(authenticated ? 403 : 401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(input.setHeaders).toHaveBeenCalledExactlyOnceWith({
        'cache-control': 'private, no-store',
      });
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])(
    'routes explicit cancellation through create authority (create=%s)',
    async (allowed) => {
      const actual = await vi.importActual<typeof import('$server/services/rbac.service')>(
        '$server/services/rbac.service',
      );
      mocks.writeCap.mockImplementation(actual.apiWriteCapability);
      mocks.identity.mockResolvedValue({ locals: { user, tenantCtx: ctx }, bypassGate: false });
      mocks.hasCap.mockImplementation(
        async (_locals: unknown, module: string, action: string) =>
          module === 'pos' && action === 'create' && allowed,
      );
      const input = event(`/api/pos/plans/operations/${operationId}/cancel`);
      const resolve = vi.fn(async () => new Response('cancel receipt'));
      const response = await runHook({ event: input, resolve });
      expect(response.status).toBe(allowed ? 200 : 403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(resolve).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(mocks.hasCap).toHaveBeenCalledWith(expect.anything(), 'pos', 'create');
      expect(actual.apiWriteCapability(`/api/pos/plans/${operationId}/cancel`, 'POST')).toEqual({
        module: 'pos',
        action: 'edit',
      });
      expect(
        actual.apiWriteCapability(`/api/pos/plans/operations/${operationId}/cancel/extra`, 'POST'),
      ).toEqual({ module: 'pos', action: 'edit' });
    },
  );
  it('installs no-store before a localized route throws and preserves the original error', async () => {
    mocks.identity.mockResolvedValue({ locals: { user, tenantCtx: ctx }, bypassGate: false });
    const input = event(`/es/api/pos/plans/operations/${operationId}`, 'GET');
    const failure = { status: 404, body: { message: 'Not found' } };
    await expect(
      runHook({
        event: input,
        resolve: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(input.setHeaders).toHaveBeenCalledExactlyOnceWith({
      'cache-control': 'private, no-store',
    });
  });
});

describe('spec 037 nav-instance guards (target path + page grant + floor)', () => {
  async function page(path: string, routeId = '/(app)/[...rest]') {
    mocks.identity.mockResolvedValue({
      locals: { user, tenantCtx: ctx, orgKind: 'business' },
      bypassGate: false,
    });
    const input = event(path, 'GET');
    (input as { route: { id: string } }).route = { id: routeId };
    const resolve = vi.fn(async () => new Response('ok'));
    try {
      const res = await runHook({ event: input, resolve });
      return { status: res.status, resolved: resolve.mock.calls.length > 0 };
    } catch (e) {
      if (!(e as { status?: number }).status) throw e;
      return { status: (e as { status: number }).status, resolved: false };
    }
  }
  const sell = '/es/staff/sell~k3x9q2';

  it('granted page + floor: 200', async () => {
    mocks.perms.mockReturnValue(['page:k3x9q2:view', 'pos:view', 'pos:create']);
    expect(await page(sell)).toEqual({ status: 200, resolved: true });
  });
  it('no page grant: 404', async () => {
    mocks.perms.mockReturnValue(['pos:view', 'pos:create']);
    expect((await page(sell)).status).toBe(404);
  });
  it('floor missing: 403, lifted when pos is dataset-enforced', async () => {
    mocks.perms.mockReturnValue(['page:k3x9q2:view']);
    expect((await page(sell)).status).toBe(403);
    mocks.enforced.list = ['pos'];
    expect(await page(sell)).toEqual({ status: 200, resolved: true });
  });
  it('page grant does not skip a stricter policy on a deeper path', async () => {
    mocks.enforced.list = ['pos']; // floor lifted: only the page grant + route policy remain
    mocks.perms.mockReturnValue(['page:k3x9q2:view']);
    expect(await page(sell)).toEqual({ status: 200, resolved: true });
    // /pos/sell/<rest> is governed by its own (POS) rule, not /pos/sell's exact override.
    expect((await page(`${sell}/x`)).resolved).toBe(false);
  });
  it('module toggled off: 404', async () => {
    mocks.perms.mockReturnValue(['page:k3x9q2:view', 'pos:view', 'pos:create']);
    mocks.moduleStates.mockReturnValue({ pos: false });
    expect((await page(sell)).status).toBe(404);
  });
  it('moved main: page string alone passes, none 404', async () => {
    mocks.perms.mockReturnValue(['page:a1b2c3:view', 'pos:view']);
    expect((await page('/es/appointments/new~a1b2c3')).resolved).toBe(true);
    mocks.perms.mockReturnValue(['pos:view']);
    expect((await page('/es/appointments/new~a1b2c3')).status).toBe(404);
  });
  it('non-instance unknown path is unchanged (kit 404s later)', async () => {
    mocks.perms.mockReturnValue([]);
    expect((await page('/es/staff/nothing', '/(app)/[...rest]')).resolved).toBe(true);
  });
  it('canonical path unchanged; explicit page row decides', async () => {
    mocks.perms.mockReturnValue(['pos:view', 'pos:create']);
    expect(await page('/es/pos/sell')).toEqual({ status: 200, resolved: true });
    mocks.explicit.mockReturnValue(false);
    expect((await page('/es/pos/sell')).status).toBe(403);
    mocks.perms.mockReturnValue([]);
    mocks.explicit.mockReturnValue(true);
    expect((await page('/es/pos/sell')).resolved).toBe(true);
  });
});
