import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireOrgCapability = vi.fn();
const setRoleOverride = vi.fn();
const clearRoleOverride = vi.fn();
const getCoreCtx = vi.fn();
const rules = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability,
  setRoleOverride,
  clearRoleOverride,
  isModuleOrSub: (x: unknown) => x === 'crm' || x === 'crm.insights',
  ACTIONS: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/nav-config.service', () => ({
  isPageRuleKey: async (_c: unknown, k: string) =>
    ['page:k3x9q2', 'section:st4ff1', 'page:/pos/sell'].includes(k),
}));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: rules.rows, error: null }) }) }),
    }),
  }),
}));

const { GET, POST, DELETE } = await import('./+server');
const locals = { tenantCtx: { tenantId: 'org-a' } };
const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/roles/overrides', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const post = (module: string) =>
  POST({
    locals,
    request: req('POST', { roleKey: 'staff', module, caps: { view: true } }),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgCapability.mockResolvedValue(undefined);
  getCoreCtx.mockResolvedValue({ tenantId: 'org-a' });
});

describe('POST /api/roles/overrides', () => {
  it.each(['page:k3x9q2', 'section:st4ff1', 'page:/pos/sell', 'crm'])('accepts %s', async (k) => {
    const res = await post(k);
    expect(res.status).toBe(200);
    expect(setRoleOverride).toHaveBeenCalledWith(
      'org-a',
      'staff',
      k,
      expect.anything(),
      false,
      undefined,
    );
  });

  it.each(['page:zzzzzz', 'page:/nope', 'settings.secret', 'section:'])('400s on %s', async (k) => {
    await expect(post(k)).rejects.toMatchObject({ status: 400 });
    expect(setRoleOverride).not.toHaveBeenCalled();
  });

  it('403s without users:manage and writes nothing', async () => {
    requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(post('page:k3x9q2')).rejects.toMatchObject({ status: 403 });
    expect(setRoleOverride).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/roles/overrides', () => {
  it('clears a page rule and 400s a malformed key', async () => {
    const ok = await DELETE({
      locals,
      request: req('DELETE', { roleKey: 'staff', module: 'page:k3x9q2' }),
    } as never);
    expect(ok.status).toBe(200);
    expect(clearRoleOverride).toHaveBeenCalledWith('org-a', 'staff', 'page:k3x9q2');
    await expect(
      DELETE({
        locals,
        request: req('DELETE', { roleKey: 'staff', module: 'page:zzzzzz' }),
      } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('403s without users:manage', async () => {
    requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(
      DELETE({
        locals,
        request: req('DELETE', { roleKey: 'staff', module: 'page:k3x9q2' }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(clearRoleOverride).not.toHaveBeenCalled();
  });
});

describe('GET /api/roles/overrides', () => {
  const get = (q: string) =>
    GET({ locals, url: new URL(`http://localhost/api/roles/overrides?module=${q}`) } as never);

  it('returns the role -> view map for a page key', async () => {
    rules.rows = [
      { role_key: 'staff', can_view: true },
      { role_key: 'viewer', can_view: false },
    ];
    expect(await (await get('page:k3x9q2')).json()).toEqual({ staff: true, viewer: false });
  });

  it('400s a module key and a malformed key; 403s a non-manager', async () => {
    await expect(get('crm')).rejects.toMatchObject({ status: 400 });
    await expect(get('page:zzzzzz')).rejects.toMatchObject({ status: 400 });
    requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(get('page:k3x9q2')).rejects.toMatchObject({ status: 403 });
  });
});
