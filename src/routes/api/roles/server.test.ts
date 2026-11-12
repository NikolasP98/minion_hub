import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireOrgCapability, createOrganizationRole } = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  createOrganizationRole: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability }));
vi.mock('$server/services/organization-role-admin.service', () => ({ createOrganizationRole }));
const { POST } = await import('./+server');
const locals = { user: { supabaseId: 'profile-1' }, tenantCtx: { tenantId: 'org-1' } };
function event(body: unknown, actor = locals) {
  return {
    locals: actor,
    request: new Request('http://localhost/api/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockReset();
  createOrganizationRole.mockResolvedValue({ key: 'custom-marketing', name: 'Marketing' });
});
describe('organization role creation API', () => {
  it('allows a role creator who does not manage Team', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'roles' || action !== 'create') throw { status: 403 };
    });
    expect((await POST(event({ source: 'blank', name: 'Marketing' }))).status).toBe(201);
  });
  it('does not treat Team management as permission to create roles', async () => {
    requireOrgCapability.mockImplementation(async (_locals, module, action) => {
      if (module !== 'users' || action !== 'manage') throw { status: 403 };
    });
    await expect(POST(event({ source: 'blank', name: 'Marketing' }))).rejects.toMatchObject({
      status: 403,
    });
    expect(createOrganizationRole).not.toHaveBeenCalled();
  });
  it('creates a versioned template copy using the authenticated organization actor', async () => {
    const body = { source: 'template', name: 'Marketing', templateId: 'staff', templateVersion: 1 };
    const response = await POST(event(body));
    expect(response.status).toBe(201);
    expect(requireOrgCapability).toHaveBeenCalledWith(locals, 'roles', 'create');
    expect(createOrganizationRole).toHaveBeenCalledWith(locals, body);
  });
  it('preserves legacy duplication requests without accepting a client organization scope', async () => {
    await POST(event({ sourceRoleKey: 'staff', name: 'Marketing' }));
    expect(createOrganizationRole).toHaveBeenCalledWith(locals, {
      source: 'duplicate',
      sourceRoleKey: 'staff',
      name: 'Marketing',
    });
  });
  it('supports an explicit blank role', async () => {
    await POST(event({ source: 'blank', name: 'Marketing' }));
    expect(createOrganizationRole).toHaveBeenCalledWith(locals, {
      source: 'blank',
      name: 'Marketing',
    });
  });
  it.each([
    { source: 'template', name: 'Marketing', templateId: 'owner', templateVersion: 1 },
    { source: 'template', name: 'Marketing', templateId: 'staff', templateVersion: 0 },
    { source: 'blank', name: 'Marketing', organizationId: 'foreign-org' },
    {
      source: 'template',
      name: 'Marketing',
      templateId: 'staff',
      templateVersion: 1,
      sourceRoleKey: 'admin',
    },
    { source: 'blank', name: '   ' },
  ])('rejects invalid or scope-changing requests %#', async (body) => {
    await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
    expect(createOrganizationRole).not.toHaveBeenCalled();
  });
  it('denies before parsing or dispatching a write', async () => {
    requireOrgCapability.mockRejectedValueOnce({ status: 403 });
    await expect(POST(event({ source: 'blank', name: 'Marketing' }))).rejects.toMatchObject({
      status: 403,
    });
    expect(createOrganizationRole).not.toHaveBeenCalled();
  });
  it('preserves a stale catalog or forbidden grant error from the policy service', async () => {
    createOrganizationRole.mockRejectedValueOnce({ status: 409 });
    await expect(POST(event({ source: 'blank', name: 'Marketing' }))).rejects.toMatchObject({
      status: 409,
    });
  });
});
