import { describe, expect, it, vi } from 'vitest';

const { can, requireOrgCapability } = vi.hoisted(() => {
  const can = vi.fn((_: string, action: string) => action === 'edit');
  return {
    can,
    requireOrgCapability: vi.fn(async () => ({ can }) as { can: typeof can } | null),
  };
});

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));

import { load } from './+layout.server';

describe('/cloud layout load', () => {
  it('reuses one capability snapshot for view, connect, and manage', async () => {
    const locals = {
      orgId: 'org-1',
      tenantCtx: { tenantId: 'tenant-fallback' },
    } as App.Locals;

    await expect(load({ locals } as Parameters<typeof load>[0])).resolves.toEqual({
      canConnect: true,
      canManage: false,
      cloudOrgId: 'org-1',
    });
    expect(requireOrgCapability).toHaveBeenCalledOnce();
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'workspace', 'view');
    expect(can.mock.calls).toEqual([
      ['workspace', 'edit'],
      ['workspace', 'manage'],
    ]);
  });

  it('grants platform admins all workspace capabilities', async () => {
    requireOrgCapability.mockResolvedValueOnce(null);
    const locals = { orgId: 'org-admin' } as App.Locals;

    await expect(load({ locals } as Parameters<typeof load>[0])).resolves.toEqual({
      canConnect: true,
      canManage: true,
      cloudOrgId: 'org-admin',
    });
  });
});
