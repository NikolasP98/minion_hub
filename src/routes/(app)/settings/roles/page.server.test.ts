import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requireOrgCapability, listRbacRoles, loadRoleSettings } = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  listRbacRoles: vi.fn(),
  loadRoleSettings: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability,
  listRbacRoles,
  ACTIONS: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
  MODULES: ['crm', 'users', 'roles'],
  BUSINESS_MODULES: ['crm'],
  MODULE_LABELS: { crm: 'CRM', users: 'Team', roles: 'Roles' },
}));
vi.mock('$server/services/organization-role-admin.service', () => ({ loadRoleSettings }));
const { load } = await import('./+page.server');
const locals = { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } };
const event = () => ({ locals, depends: vi.fn() }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockReset();
  listRbacRoles.mockResolvedValue([{ key: 'custom-marketing', name: 'Marketing' }]);
  loadRoleSettings.mockResolvedValue({
    roleModel: 'organization',
    defaultRoleKey: 'custom-administrator',
    templates: [],
  });
});
describe('role settings read capability', () => {
  it('allows role-view access without granting or requiring role CRUD or Team management', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'view') throw { status: 403 };
    });
    const result = await load(event());
    expect(result).toMatchObject({
      roles: [{ key: 'custom-marketing' }],
      roleSettings: { roleModel: 'organization' },
    });
    expect(requireOrgCapability).toHaveBeenCalledTimes(1);
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'roles', 'view');
  });
  it('does not turn Team management into role-matrix read access', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'users' || action !== 'manage') throw { status: 403 };
    });
    await expect(load(event())).rejects.toMatchObject({ status: 403 });
    expect(listRbacRoles).not.toHaveBeenCalled();
    expect(loadRoleSettings).not.toHaveBeenCalled();
  });
});
