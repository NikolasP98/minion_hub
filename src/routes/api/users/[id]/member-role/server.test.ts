import { beforeEach, describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({
  require: vi.fn(),
  assignable: vi.fn(),
  replace: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: boundary.require,
  isAssignableRoleKey: boundary.assignable,
  setMemberRole: boundary.replace,
  addMemberRole: boundary.add,
  removeMemberRole: boundary.remove,
}));
const { PATCH, POST, DELETE } = await import('./+server');
const locals = {
  user: { supabaseId: 'authenticated-grantor' },
  tenantCtx: { tenantId: 'active-org' },
};
const event = (method: string, body: unknown) =>
  ({
    locals,
    params: { id: 'target-profile' },
    request: new Request('http://localhost/api/users/target-profile/member-role', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }) as never;
const actions = [
  { method: 'PATCH', handler: PATCH, writer: boundary.replace },
  { method: 'POST', handler: POST, writer: boundary.add },
  { method: 'DELETE', handler: DELETE, writer: boundary.remove },
];
beforeEach(() => {
  vi.resetAllMocks();
  boundary.assignable.mockResolvedValue(true);
});
describe('member-role assignment API authority boundary', () => {
  it.each(actions)(
    '$method forwards only the active organization and authenticated grantor',
    async ({ method, handler, writer }) => {
      const response = await handler(
        event(method, {
          roleKey: 'admin',
          grantedBy: 'forged',
          system: true,
          organizationId: 'foreign-org',
        }),
      );
      expect(response.status).toBe(200);
      expect(boundary.require).toHaveBeenCalledWith(locals, 'users', 'manage');
      expect(boundary.assignable).toHaveBeenCalledWith('active-org', 'admin');
      expect(writer).toHaveBeenCalledWith(
        'active-org',
        'target-profile',
        'admin',
        'authenticated-grantor',
      );
    },
  );
  it.each(actions)(
    '$method preserves a fresh service denial without reporting success',
    async ({ method, handler, writer }) => {
      writer.mockRejectedValue({
        status: 403,
        body: { message: 'Cannot grant beyond current authority' },
      });
      await expect(handler(event(method, { roleKey: 'admin' }))).rejects.toMatchObject({
        status: 403,
      });
    },
  );
  it('rejects a foreign role key before invoking any assignment writer', async () => {
    boundary.assignable.mockResolvedValue(false);
    await expect(PATCH(event('PATCH', { roleKey: 'custom-foreign' }))).rejects.toMatchObject({
      status: 400,
    });
    expect(boundary.replace).not.toHaveBeenCalled();
    expect(boundary.add).not.toHaveBeenCalled();
    expect(boundary.remove).not.toHaveBeenCalled();
  });
  it('denies missing Team authority before catalog lookup or assignment', async () => {
    boundary.require.mockRejectedValue({ status: 403 });
    await expect(POST(event('POST', { roleKey: 'admin' }))).rejects.toMatchObject({ status: 403 });
    expect(boundary.assignable).not.toHaveBeenCalled();
    expect(boundary.add).not.toHaveBeenCalled();
  });
});
