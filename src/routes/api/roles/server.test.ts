import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const listRoleCatalog = vi.fn();
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability,
  listRoleCatalog,
  createCustomRole: vi.fn(),
}));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockResolvedValue(undefined);
});

describe('GET /api/roles', () => {
  it('lists the catalog as { key, name, isSystem }', async () => {
    listRoleCatalog.mockResolvedValue([
      { key: 'staff', name: 'Staff', rank: 1, description: null },
      { key: 'cashier', name: 'Cashier', rank: 0, description: null, isCustom: true },
    ]);
    const res = await GET({ locals: { tenantCtx: { tenantId: 'org-a' } } } as never);
    expect(await res.json()).toEqual({
      roles: [
        { key: 'staff', name: 'Staff', isSystem: true },
        { key: 'cashier', name: 'Cashier', isSystem: false },
      ],
    });
  });

  it('403s without users:manage', async () => {
    requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(GET({ locals: { tenantCtx: { tenantId: 'o' } } } as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(listRoleCatalog).not.toHaveBeenCalled();
  });
});
