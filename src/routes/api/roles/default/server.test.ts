import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requireOrgCapability, setDefaultOrganizationRole } = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  setDefaultOrganizationRole: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/organization-role-admin.service', () => ({ setDefaultOrganizationRole }));
const { PATCH } = await import('./+server');
const locals = { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } };
const revision = 'b'.repeat(64);
const event = (body: unknown) =>
  ({
    locals,
    request: new Request('http://localhost/api/roles/default', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockReset();
});
describe('organization default-role API', () => {
  it('requires both role editing and Team management to change the admission default', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'edit') throw { status: 403 };
    });
    await expect(PATCH(event({ roleKey: 'custom-sales', revision }))).rejects.toMatchObject({
      status: 403,
    });
    expect(setDefaultOrganizationRole).not.toHaveBeenCalled();
  });
  it('delegates revision and role validation with the authenticated organization', async () => {
    setDefaultOrganizationRole.mockResolvedValue({ defaultRoleKey: 'custom-sales', revision });
    await PATCH(event({ roleKey: 'custom-sales', revision }));
    expect(requireOrgCapability).toHaveBeenNthCalledWith(1, locals, 'roles', 'edit');
    expect(requireOrgCapability).toHaveBeenNthCalledWith(2, locals, 'users', 'manage');
    expect(setDefaultOrganizationRole).toHaveBeenCalledWith(locals, {
      roleKey: 'custom-sales',
      revision,
    });
  });
  it.each([
    { roleKey: 'custom-sales' },
    { roleKey: 'custom-sales', revision, organizationId: 'foreign' },
  ])('rejects incomplete or scope-changing input', async (body) => {
    await expect(PATCH(event(body))).rejects.toMatchObject({ status: 400 });
    expect(setDefaultOrganizationRole).not.toHaveBeenCalled();
  });
  it('returns policy conflicts without reporting success', async () => {
    setDefaultOrganizationRole.mockRejectedValueOnce({ status: 409 });
    await expect(PATCH(event({ roleKey: 'custom-sales', revision }))).rejects.toMatchObject({
      status: 409,
    });
  });
});
