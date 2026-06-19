/**
 * Smoke tests for server-side load helpers.
 *
 * These verify that each helper:
 *   1. Has the (ctx: LoadCtx, userId: string) => Promise<T> shape.
 *   2. Delegates to the underlying service function.
 *   3. Returns a response that matches the byte-shape of the corresponding
 *      API endpoint.
 *
 * The actual business logic is unit-tested via the existing service tests
 * (roles.service, server.service, user-preferences.service, etc.). Here
 * we only test the shim layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGetPermissionsForUser = vi.fn<(ctx: unknown, userId: string) => Promise<Set<string>>>();
vi.mock('../roles.service', () => ({
  getPermissionsForUser: (ctx: unknown, userId: string) => mockGetPermissionsForUser(ctx, userId),
}));

const mockListGatewayHostsForUser =
  vi.fn<(profileId: string | null, isAdmin: boolean) => Promise<unknown[]>>();
vi.mock('../gateway.pg.service', () => ({
  listGatewayHostsForUser: (profileId: string | null, isAdmin: boolean) =>
    mockListGatewayHostsForUser(profileId, isAdmin),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ── permissions.service ──────────────────────────────────────────────────────

describe('loadPermissionsForUser', () => {
  it('derives permissions from the Supabase profile role (no Turso roles read)', async () => {
    const { loadPermissionsForUser, derivePermissionsFromRole } =
      await import('../permissions.service');

    const admin = await loadPermissionsForUser(
      { tenantCtx: { db: {}, tenantId: 't1' } as never, user: { role: 'admin' } as never },
      'u1',
    );
    expect(new Set(admin.permissions)).toEqual(derivePermissionsFromRole('admin'));

    const member = await loadPermissionsForUser(
      { tenantCtx: { db: {}, tenantId: 't1' } as never, user: { role: 'user' } as never },
      'u1',
    );
    expect(new Set(member.permissions)).toEqual(derivePermissionsFromRole('user'));

    // GoTrue migration removed the self-host roles.service read entirely.
    expect(mockGetPermissionsForUser).not.toHaveBeenCalled();
  });

  it('throws 401 when tenantCtx is absent', async () => {
    const { loadPermissionsForUser } = await import('../permissions.service');
    await expect(loadPermissionsForUser({}, 'u1')).rejects.toMatchObject({ status: 401 });
  });
});

// ── hosts.service ────────────────────────────────────────────────────────────

describe('loadHostsForUser', () => {
  it('returns the Supabase gateway host list as authoritative', async () => {
    mockListGatewayHostsForUser.mockResolvedValue([{ id: 's1', name: 'host-1' }]);
    const { loadHostsForUser } = await import('../hosts.service');

    const result = await loadHostsForUser({ user: { supabaseId: 'p1' } } as never, 'u1', 'admin');
    expect(result).toEqual({
      servers: [{ id: 's1', name: 'host-1' }],
      authoritative: true,
    });
    expect(mockListGatewayHostsForUser).toHaveBeenCalledWith('p1', true);
  });

  it('returns authoritative empty list when no gateways seeded', async () => {
    mockListGatewayHostsForUser.mockResolvedValue([]);
    const { loadHostsForUser } = await import('../hosts.service');

    const result = await loadHostsForUser({ user: { supabaseId: 'p1' } } as never, 'u1', 'user');
    expect(result).toEqual({ servers: [], authoritative: true });
    expect(mockListGatewayHostsForUser).toHaveBeenCalledWith('p1', false);
  });
});
