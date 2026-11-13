import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requireOrgCapability, renameOrganizationRole, deleteCustomRole } = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  renameOrganizationRole: vi.fn(),
  deleteCustomRole: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability,
  deleteCustomRole,
}));
vi.mock('$server/services/organization-role-admin.service', () => ({ renameOrganizationRole }));
const { PATCH, DELETE } = await import('./+server');
const locals = { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } };
const revision = 'a'.repeat(64);
const event = (body: unknown) =>
  ({
    locals,
    params: { key: 'custom-sales' },
    request: new Request('http://localhost/api/roles/custom-sales', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockReset();
});
describe('organization role rename API', () => {
  it('denies a Team manager without roles:edit', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'users' || action !== 'manage') throw { status: 403 };
    });
    await expect(PATCH(event({ name: 'Sales', revision }))).rejects.toMatchObject({ status: 403 });
    expect(renameOrganizationRole).not.toHaveBeenCalled();
  });
  it('requires roles:delete independently from role editing', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'edit') throw { status: 403 };
    });
    await expect(DELETE(event({}))).rejects.toMatchObject({ status: 403 });
    expect(deleteCustomRole).not.toHaveBeenCalled();
  });
  it('passes a deletion through its distinct role-delete guard', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'delete') throw { status: 403 };
    });
    expect((await DELETE(event({}))).status).toBe(200);
    expect(deleteCustomRole).toHaveBeenCalledWith('org-1', 'custom-sales', locals);
  });
  it('renames the stable key with a revision and the real organization actor', async () => {
    renameOrganizationRole.mockResolvedValue({ key: 'custom-sales', name: 'Sales', revision });
    const response = await PATCH(event({ name: 'Sales', revision }));
    expect(await response.json()).toMatchObject({ key: 'custom-sales', name: 'Sales' });
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'roles', 'edit');
    expect(renameOrganizationRole).toHaveBeenCalledWith(locals, 'custom-sales', {
      name: 'Sales',
      revision,
    });
  });
  it('rejects missing revision before calling the policy writer', async () => {
    await expect(PATCH(event({ name: 'Sales' }))).rejects.toMatchObject({ status: 400 });
    expect(renameOrganizationRole).not.toHaveBeenCalled();
  });
  it('cannot write without role-management permission', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    await expect(PATCH(event({ name: 'Sales', revision }))).rejects.toMatchObject({ status: 403 });
    expect(renameOrganizationRole).not.toHaveBeenCalled();
  });
});
