import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requireOrgCapability, writeSectionAccess, resetRegisteredRolePolicies } = vi.hoisted(
  () => ({
    requireOrgCapability: vi.fn(),
    writeSectionAccess: vi.fn(),
    resetRegisteredRolePolicies: vi.fn(),
  }),
);
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability,
  isModuleOrSub: (module: unknown) => module === 'crm' || module === 'roles',
}));
vi.mock('$server/services/section-access.service', () => ({
  writeSectionAccess,
  resetRegisteredRolePolicies,
}));
const { POST, DELETE } = await import('./+server');
const locals = { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } };
const body = {
  roleKey: 'custom-staff',
  module: 'crm',
  revision: 'a'.repeat(64),
  caps: { view: true, create: false, edit: false, delete: false, export: false, manage: false },
};
const event = (value: unknown = body) =>
  ({
    locals,
    request: new Request('http://localhost/api/roles/overrides', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    }),
  }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockReset();
  writeSectionAccess.mockResolvedValue({ revision: 'b'.repeat(64) });
});
describe('role permission-edit API capability', () => {
  it('allows a roles:edit actor without Team management to edit permissions', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'edit') throw { status: 403 };
    });
    expect((await POST(event())).status).toBe(200);
    expect(writeSectionAccess).toHaveBeenCalledWith(
      locals,
      expect.objectContaining({ target: 'crm', roleKey: 'custom-staff', mode: 'override' }),
      undefined,
    );
  });
  it('rejects Team management alone before any permission write', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'users' || action !== 'manage') throw { status: 403 };
    });
    await expect(POST(event())).rejects.toMatchObject({ status: 403 });
    expect(writeSectionAccess).not.toHaveBeenCalled();
  });
  it('clearing an override requires role editing, independently from deleting a role', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'delete') throw { status: 403 };
    });
    const { caps, ...reset } = body;
    await expect(DELETE(event(reset))).rejects.toMatchObject({ status: 403 });
    expect(writeSectionAccess).not.toHaveBeenCalled();
    expect(resetRegisteredRolePolicies).not.toHaveBeenCalled();
  });
});
