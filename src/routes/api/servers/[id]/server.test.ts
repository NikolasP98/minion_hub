import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gatewayBelongsToOrg: vi.fn(),
  resolveGatewayId: vi.fn(),
  userHasGatewayAccess: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
}));

let currentUser: { id: string; role: 'user' | 'admin'; supabaseId?: string } = {
  id: 'user-1',
  role: 'admin',
  supabaseId: 'profile-1',
};

vi.mock('$server/auth/authorize', () => ({
  requireAuth: () => currentUser,
}));

vi.mock('$server/auth/tenant-ctx', () => ({
  getOrCreateTenantCtx: () => Promise.resolve({ db: fakeDb, tenantId: 'org-a' }),
}));

vi.mock('$server/services/server.service', () => ({
  updateServer: mocks.updateServer,
  deleteServer: mocks.deleteServer,
}));

vi.mock('$server/services/gateway.pg.service', () => ({
  userHasGatewayAccess: mocks.userHasGatewayAccess,
  gatewayBelongsToOrg: mocks.gatewayBelongsToOrg,
  resolveGatewayId: mocks.resolveGatewayId,
}));

vi.mock('@minion-stack/db/schema', () => ({
  servers: { id: 'id', tenantId: 'tenantId' },
  userServers: { userId: 'userId', serverId: 'serverId' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => ({ and: args }),
}));

// Turso fallback rows consulted only for servers unbridged from the Supabase
// gateway registry — one row per test, set via `fakeDbRows`.
let fakeDbRows: Array<Record<string, unknown>>;
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => Promise.resolve(fakeDbRows),
    }),
  }),
};

import { PUT, DELETE } from './+server';

function event(id = 'server-1') {
  return {
    locals: { user: currentUser, orgId: 'org-a' },
    params: { id },
    request: { json: () => Promise.resolve({ name: 'renamed' }) },
  } as never;
}

describe('PUT /api/servers/[id] — tenant boundary', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1', role: 'admin', supabaseId: 'profile-1' };
    mocks.gatewayBelongsToOrg.mockReset();
    mocks.resolveGatewayId.mockReset().mockResolvedValue('gateway-1');
    mocks.userHasGatewayAccess.mockReset().mockResolvedValue(false);
    mocks.updateServer.mockReset().mockResolvedValue('server-1');
    mocks.deleteServer.mockReset().mockResolvedValue(undefined);
    fakeDbRows = [];
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
    expect(mocks.updateServer).toHaveBeenCalledWith(
      expect.anything(),
      'server-1',
      expect.objectContaining({ name: 'renamed' }),
    );
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
    mocks.userHasGatewayAccess.mockResolvedValue(false);
    fakeDbRows = []; // userServers link lookup

    const response = await PUT(event());

    expect(response.status).toBe(404);
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  // M2: an admin who clears the tenant-boundary check but supplies a stale or
  // fabricated id must not receive a false `{ ok: true }`.
  test('404s when updateServer finds no matching row', async () => {
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    mocks.updateServer.mockResolvedValue(null);

    const response = await PUT(event());

    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/servers/[id] — tenant boundary', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1', role: 'admin', supabaseId: 'profile-1' };
    mocks.gatewayBelongsToOrg.mockReset();
    mocks.resolveGatewayId.mockReset().mockResolvedValue('gateway-1');
    mocks.deleteServer.mockReset().mockResolvedValue(undefined);
    fakeDbRows = [];
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
    expect(mocks.deleteServer).toHaveBeenCalled();
  });
});
