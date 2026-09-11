import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getTenant: vi.fn(),
  lookup: vi.fn(),
  gatewayBelongsToOrg: vi.fn(),
  resolveGatewayId: vi.fn(),
  userHasGatewayAccess: vi.fn(),
  updateGatewayForOrgByServerId: vi.fn(),
  deleteGatewayForOrgByServerId: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
}));

let currentUser: { id: string; role: 'user' | 'admin'; supabaseId?: string } = {
  id: 'user-1',
  role: 'admin',
  supabaseId: 'profile-1',
};

vi.mock('$server/auth/authorize', () => ({ requireAuth: mocks.requireAuth }));

vi.mock('$server/auth/tenant-ctx', () => ({ getOrCreateTenantCtx: mocks.getTenant }));

// The 09-03 URL policy runs the real ssrf-guard; only DNS is stubbed.
vi.mock('node:dns', () => ({ promises: { lookup: mocks.lookup } }));

vi.mock('$server/services/server.service', () => ({
  updateServer: mocks.updateServer,
  deleteServer: mocks.deleteServer,
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  userHasGatewayAccess: mocks.userHasGatewayAccess,
  gatewayBelongsToOrg: mocks.gatewayBelongsToOrg,
  resolveGatewayId: mocks.resolveGatewayId,
  updateGatewayForOrgByServerId: mocks.updateGatewayForOrgByServerId,
  deleteGatewayForOrgByServerId: mocks.deleteGatewayForOrgByServerId,
}));

vi.mock('@minion-stack/db/schema', () => ({
  servers: { id: 'id', tenantId: 'tenantId' },
  userServers: { userId: 'userId', serverId: 'serverId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => ({ and: args }),
}));

// Turso rows returned by the tenant check and, for unbridged non-admins, the
// subsequent personal-link check. Most tests use `fakeDbRows`; the two-query
// cases enqueue distinct results in `fakeDbRowQueue`.
let fakeDbRows: Array<Record<string, unknown>>;
let fakeDbRowQueue: Array<Array<Record<string, unknown>>>;
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(fakeDbRowQueue.shift() ?? fakeDbRows),
    }),
  }),
};

import { PUT, DELETE } from './+server';

// Imported once at module load: resolving it inside a test costs more than the
// per-test timeout when the whole suite runs in parallel.
const { getOrCreateTenantCtx: actualGetOrCreateTenantCtx } =
  await vi.importActual<typeof import('$server/auth/tenant-ctx')>('$server/auth/tenant-ctx');

function event(id = 'server-1') {
  return {
    locals: { user: currentUser, orgId: 'org-a' },
    params: { id },
    request: { json: () => Promise.resolve({ name: 'renamed' }) },
  } as never;
}

// Shared defaults. Describe-level hooks run after these and may override.
beforeEach(() => {
  mocks.requireAuth.mockReset().mockImplementation(() => currentUser);
  mocks.getTenant
    .mockReset()
    .mockImplementation(() => Promise.resolve({ db: fakeDb, tenantId: 'org-a' }));
  mocks.lookup.mockReset().mockResolvedValue({ address: '8.8.8.8', family: 4 });
  vi.stubEnv('SSRF_ALLOWED_HOSTNAME_SUFFIXES', '');
  vi.stubEnv('SSRF_ALLOW_TAILSCALE_CGNAT', 'false');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PUT /api/servers/[id] — tenant boundary', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1', role: 'admin', supabaseId: 'profile-1' };
    mocks.gatewayBelongsToOrg.mockReset();
    mocks.resolveGatewayId.mockReset().mockResolvedValue('gateway-1');
    mocks.userHasGatewayAccess.mockReset().mockResolvedValue(false);
    mocks.updateGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
    mocks.deleteGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
    mocks.updateServer.mockReset().mockResolvedValue('server-1');
    mocks.deleteServer.mockReset().mockResolvedValue(undefined);
    fakeDbRows = [{ id: 'server-1' }];
    fakeDbRowQueue = [];
  });

  // The regression H1 asked for: an admin of org-a supplying org-b's (bridged)
  // server id must not be able to patch it, admin included.
  test('404s a bridged server assigned to a foreign org, admin included', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(false);

    const response = await PUT(event());

    expect(response.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('allows the mutation once the bridged server is confirmed to belong to the org', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);

    const response = await PUT(event());

    expect(response.status).toBe(200);
    expect(mocks.updateGatewayForOrgByServerId).toHaveBeenCalledWith(
      'server-1',
      'org-a',
      expect.objectContaining({ name: 'renamed' }),
    );
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('updates canonical Postgres when the bridged gateway has no legacy Turso row', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    fakeDbRows = [];

    const response = await PUT(event());

    expect(response.status).toBe(200);
    expect(mocks.updateServer).not.toHaveBeenCalled();
    expect(mocks.updateGatewayForOrgByServerId).toHaveBeenCalledWith(
      'server-1',
      'org-a',
      expect.objectContaining({ name: 'renamed' }),
    );
  });

  test('bridged server: non-admin still needs their personal gateway link', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    mocks.userHasGatewayAccess.mockResolvedValue(false);

    const denied = await PUT(event());
    expect(denied.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();

    mocks.userHasGatewayAccess.mockResolvedValue(true);
    const allowed = await PUT(event());
    expect(allowed.status).toBe(200);
    expect(mocks.updateGatewayForOrgByServerId).toHaveBeenCalled();
  });

  test('bridged server: fails closed when the personal-link lookup throws', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    mocks.userHasGatewayAccess.mockRejectedValue(new Error('ECONNRESET'));

    const response = await PUT(event());

    expect(response.status).toBe(503);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('fails closed (503) when the gateway registry throws', async () => {
    mocks.resolveGatewayId.mockRejectedValue(new Error('ECONNRESET'));

    const response = await PUT(event());

    expect(response.status).toBe(503);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('unbridged server: admin scoped to Turso servers.tenantId, not org-wide', async () => {
    mocks.resolveGatewayId.mockResolvedValue(null);
    fakeDbRows = []; // no row matches (id, tenantId) for this admin's org

    const response = await PUT(event());

    expect(response.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('unbridged server: admin succeeds when the Turso row is in their own org', async () => {
    mocks.resolveGatewayId.mockResolvedValue(null);
    fakeDbRows = [{ id: 'server-1' }];

    const response = await PUT(event());

    expect(response.status).toBe(200);
    expect(mocks.updateServer).toHaveBeenCalled();
  });

  test('unbridged server: non-admin without any personal link is denied', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    mocks.resolveGatewayId.mockResolvedValue(null);
    fakeDbRowQueue = [[{ id: 'server-1' }], []];

    const response = await PUT(event());

    expect(response.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('unbridged server: non-admin with an in-tenant personal link is allowed', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    mocks.resolveGatewayId.mockResolvedValue(null);
    fakeDbRowQueue = [[{ id: 'server-1' }], [{ serverId: 'server-1' }]];

    const response = await PUT(event());

    expect(response.status).toBe(200);
    expect(mocks.updateServer).toHaveBeenCalled();
  });

  // M2: an admin who clears the tenant-boundary check but supplies a stale or
  // fabricated id must not receive a false `{ ok: true }`.
  test('404s when updateServer finds no matching row', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    mocks.updateGatewayForOrgByServerId.mockResolvedValue(null);

    const response = await PUT(event());

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/servers/[id] — tenant boundary', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1', role: 'admin', supabaseId: 'profile-1' };
    mocks.gatewayBelongsToOrg.mockReset();
    mocks.resolveGatewayId.mockReset().mockResolvedValue('gateway-1');
    mocks.userHasGatewayAccess.mockReset().mockResolvedValue(false);
    mocks.updateGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
    mocks.deleteGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
    mocks.deleteServer.mockReset().mockResolvedValue(undefined);
    fakeDbRows = [{ id: 'server-1' }];
    fakeDbRowQueue = [];
  });

  test('404s a bridged server assigned to a foreign org, admin included', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(false);

    const response = await DELETE(event());

    expect(response.status).toBe(404);
    expect(mocks.deleteServer).not.toHaveBeenCalled();
  });

  test('allows the delete once the bridged server is confirmed to belong to the org', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);

    const response = await DELETE(event());

    expect(response.status).toBe(200);
    expect(mocks.deleteGatewayForOrgByServerId).toHaveBeenCalledWith('server-1', 'org-a');
    expect(mocks.deleteServer).not.toHaveBeenCalled();
  });

  test('bridged server: non-admin delete still requires their personal gateway link', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);

    const denied = await DELETE(event());
    expect(denied.status).toBe(404);
    expect(mocks.deleteServer).not.toHaveBeenCalled();

    mocks.userHasGatewayAccess.mockResolvedValue(true);
    const allowed = await DELETE(event());
    expect(allowed.status).toBe(200);
    expect(mocks.deleteGatewayForOrgByServerId).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 09-01 (SEC-03) credential-safe diagnostics and 09-03 (SV-03) URL policy
// parity, re-based onto the #210 gateway-auth handler flow.
// ---------------------------------------------------------------------------

const secret = 'synthetic-update-credential-DO-NOT-LOG';

function eventWith(body: Record<string, unknown>, locals?: App.Locals) {
  return {
    locals: locals ?? { user: currentUser, orgId: 'org-a' },
    params: { id: 'server-1' },
    request: { json: () => Promise.resolve(body) },
  } as never;
}

function diagnostics() {
  return JSON.stringify(
    [
      ...vi.mocked(console.error).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.log).mock.calls,
    ],
    (_key, value) =>
      value instanceof Error ? { message: value.message, stack: value.stack } : value,
  );
}

// Legacy (unbridged) defaults: resolveGatewayId → null, so the handler takes the
// Turso path and `updateServer`/`deleteServer` are the persistence sinks.
function unbridgedDefaults() {
  currentUser = { id: 'user-1', role: 'admin', supabaseId: 'profile-1' };
  mocks.gatewayBelongsToOrg.mockReset().mockResolvedValue(true);
  mocks.resolveGatewayId.mockReset().mockResolvedValue(null);
  mocks.userHasGatewayAccess.mockReset().mockResolvedValue(false);
  mocks.updateGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
  mocks.deleteGatewayForOrgByServerId.mockReset().mockResolvedValue('gateway-1');
  mocks.updateServer.mockReset().mockResolvedValue('server-1');
  mocks.deleteServer.mockReset().mockResolvedValue(undefined);
  fakeDbRows = [{ id: 'server-1' }];
  fakeDbRowQueue = [];
}

describe('server update diagnostics', () => {
  beforeEach(unbridgedDefaults);

  test('passes a new token to persistence without logging it', async () => {
    const response = await PUT(eventWith({ token: secret }));
    expect(response.status).toBe(200);
    expect(mocks.updateServer).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-a' }),
      'server-1',
      { token: secret },
    );
    expect(diagnostics()).not.toContain(secret);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  test('sanitizes a failed token update in both logs and HTTP response', async () => {
    mocks.updateServer.mockRejectedValue(new Error(`bound update value: ${secret}`));
    const response = await PUT(eventWith({ token: secret }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Unable to update server.',
    });
    expect(diagnostics()).not.toContain(secret);
  });

  test('sanitizes backend errors during deletion', async () => {
    mocks.deleteServer.mockRejectedValue(new Error(`backend detail: ${secret}`));
    const response = await DELETE(event());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Unable to delete server.',
    });
    expect(diagnostics()).not.toContain(secret);
  });

  test('still denies a user without a server link', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    fakeDbRowQueue = [[{ id: 'server-1' }], []];
    const response = await PUT(eventWith({ token: secret }));
    expect(response.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('requires authentication before database or persistence work', async () => {
    mocks.requireAuth.mockImplementation(() => {
      throw new Error('Authentication required');
    });
    await expect(PUT(eventWith({ token: secret }))).rejects.toThrow('Authentication required');
    expect(mocks.getTenant).not.toHaveBeenCalled();
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });
});

describe('server update URL policy with the real guard', () => {
  beforeEach(unbridgedDefaults);

  test.each([
    'http://127.0.0.1:9999/',
    'ws://10.0.0.1/',
    'https://localhost/',
    'invalid',
    '',
    null,
  ])('denies supplied URL %s before persistence', async (url) => {
    const response = await PUT(eventWith({ url, token: secret }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Server URL is not allowed.',
    });
    expect(mocks.updateServer).not.toHaveBeenCalled();
    expect(diagnostics()).not.toContain(secret);
  });

  test.each(['http:', 'https:', 'ws:', 'wss:'])(
    'accepts a valid %s URL including a resubmitted unchanged URL',
    async (protocol) => {
      const body = { url: `${protocol}//gateway.example.test/` };
      expect((await PUT(eventWith(body))).status).toBe(200);
      expect(mocks.updateServer).toHaveBeenCalledWith(expect.any(Object), 'server-1', body);
      expect(mocks.lookup).toHaveBeenCalledWith('gateway.example.test');
    },
  );

  // The canonical (bridged) write introduced by #210 goes through the same guard.
  test('denies a blocked URL before the canonical gateway write', async () => {
    mocks.resolveGatewayId.mockResolvedValue('gateway-1');
    const response = await PUT(eventWith({ url: 'http://127.0.0.1:9999/', token: secret }));
    expect(response.status).toBe(422);
    expect(mocks.updateGatewayForOrgByServerId).not.toHaveBeenCalled();
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test('preserves an explicitly linked nonadmin update', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    fakeDbRowQueue = [[{ id: 'server-1' }], [{ serverId: 'server-1' }]];
    expect((await PUT(eventWith({ url: 'wss://gateway.example.test/' }))).status).toBe(200);
    expect(mocks.updateServer).toHaveBeenCalled();
  });

  test('preserves operator-authorized private hostname policy', async () => {
    vi.stubEnv('SSRF_ALLOWED_HOSTNAME_SUFFIXES', '.ts.net');
    const body = { url: 'wss://gateway.synthetic.ts.net/' };
    expect((await PUT(eventWith(body))).status).toBe(200);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.updateServer).toHaveBeenCalled();
  });

  test('preserves explicit Tailscale CGNAT opt-in', async () => {
    vi.stubEnv('SSRF_ALLOW_TAILSCALE_CGNAT', 'true');
    expect((await PUT(eventWith({ url: 'wss://100.64.0.1/' }))).status).toBe(200);
    expect(mocks.updateServer).toHaveBeenCalled();
  });

  test('denies unresolved private DNS without exposing the URL', async () => {
    mocks.lookup.mockResolvedValue({ address: '192.168.1.2', family: 4 });
    const response = await PUT(eventWith({ url: `wss://gateway.example.test/?token=${secret}` }));
    expect(response.status).toBe(422);
    expect(mocks.updateServer).not.toHaveBeenCalled();
    expect(diagnostics()).not.toContain(secret);
  });

  test('checks the server link before DNS or mutation', async () => {
    currentUser = { id: 'user-2', role: 'user', supabaseId: 'profile-2' };
    fakeDbRowQueue = [[{ id: 'server-1' }], []];
    expect((await PUT(eventWith({ url: 'wss://gateway.example.test/' }))).status).toBe(404);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  test.each(['PUT', 'DELETE'])(
    'uses the real tenant helper to deny no-tenant %s',
    async (method) => {
      mocks.getTenant.mockImplementation(actualGetOrCreateTenantCtx);
      const noTenant = eventWith({ url: 'wss://gateway.example.test/' }, {} as App.Locals);
      await expect((method === 'PUT' ? PUT : DELETE)(noTenant)).rejects.toMatchObject({
        status: 403,
      });
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.updateServer).not.toHaveBeenCalled();
      expect(mocks.deleteServer).not.toHaveBeenCalled();
    },
  );
});
