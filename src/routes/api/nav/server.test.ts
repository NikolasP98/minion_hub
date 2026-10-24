import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforced = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('$lib/permissions', async (orig) => ({
  ...(await orig<typeof import('$lib/permissions')>()),
  get DATASET_ENFORCED() {
    return enforced.list;
  },
}));

const requireOrgCapability = vi.fn();
const invalidateRbac = vi.fn();
const getCoreCtx = vi.fn();
const readNavConfig = vi.fn();
const writeNavConfig = vi.fn();
const deleteOrphanPageRules = vi.fn();
const loadPermissionsForUser = vi.fn();

vi.mock('$server/services/rbac.service', () => ({ requireOrgCapability, invalidateRbac }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx }));
vi.mock('$server/services/nav-config.service', () => ({
  readNavConfig,
  writeNavConfig,
  deleteOrphanPageRules,
}));
vi.mock('$server/services/permissions.service', () => ({ loadPermissionsForUser }));

const config = await import('./config/+server');
const resolve = await import('./resolve/+server');

const doc = (over: Record<string, unknown> = {}, pageOver: Record<string, unknown> = {}) => ({
  version: 1,
  sections: [
    {
      id: 'st4ff1',
      slug: 'staff',
      label: 'Staff',
      pages: [
        {
          id: 'k3x9q2',
          kind: 'link',
          slug: 'sell',
          label: 'Sell',
          target: '/pos/sell',
          ...pageOver,
        },
      ],
      ...over,
    },
  ],
  builtinSections: {},
  builtin: {},
});

const put = (body: unknown) =>
  config.PUT!({
    locals: {},
    request: new Request('http://localhost/api/nav/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);

const get = (path?: string) =>
  resolve.GET!({
    locals: { user: { id: 'u1', role: 'user' } },
    url: new URL(
      'http://localhost/api/nav/resolve' +
        (path === undefined ? '' : `?path=${encodeURIComponent(path)}`),
    ),
  } as never);

const perms = (...permissions: string[]) =>
  loadPermissionsForUser.mockResolvedValue({ permissions, roles: ['staff'] });

beforeEach(() => {
  vi.clearAllMocks();
  enforced.list = [];
  requireOrgCapability.mockResolvedValue(undefined);
  getCoreCtx.mockResolvedValue({ tenantId: 'org-a' });
  writeNavConfig.mockImplementation(async (_ctx, c) => c);
  readNavConfig.mockResolvedValue(doc());
});

describe('PUT /api/nav/config', () => {
  it('403s for a manager', async () => {
    requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(put(doc())).rejects.toMatchObject({ status: 403 });
    expect(writeNavConfig).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid body (uuid-shaped id)', async () => {
    await expect(
      put(doc({}, { id: '22222222-2222-4222-8222-222222222222' })),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(writeNavConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['slug.reserved', doc({ slug: 'pos' })],
    ['target.invalid', doc({}, { target: '/pos' })],
    [
      'main.duplicate',
      doc({
        pages: [
          { id: 'aaaaaa', kind: 'main', slug: 'a', label: 'A', target: '/pos/sell' },
          { id: 'bbbbbb', kind: 'main', slug: 'b', label: 'B', target: '/pos/sell' },
        ],
      }),
    ],
    [
      'id.invalid',
      doc({
        id: 'st4ff1',
        pages: [{ id: 'st4ff1', kind: 'link', slug: 'a', label: 'A', target: '/pos/sell' }],
      }),
    ],
  ])('400s with %s', async (code, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_nav_config');
    expect(json.issues.map((i: { code: string }) => i.code)).toContain(code);
    expect(writeNavConfig).not.toHaveBeenCalled();
  });

  it('round-trips a valid document, prunes orphan rules and busts rbac', async () => {
    const res = await put(doc());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(doc());
    expect(deleteOrphanPageRules).toHaveBeenCalledWith('org-a', ['page:k3x9q2', 'section:st4ff1']);
    expect(invalidateRbac).toHaveBeenCalledWith('org-a');
  });
});

describe('GET /api/nav/resolve', () => {
  it('resolves a granted instance and keeps the prefix', async () => {
    perms('page:k3x9q2:view', 'pos:view');
    const res = await get('/staff/sell~k3x9q2/abc');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      prefix: '/staff/sell~k3x9q2',
      target: '/pos/sell',
      id: 'k3x9q2',
    });
  });

  it('404s without the page string', async () => {
    perms('pos:view');
    expect((await get('/staff/sell~k3x9q2')).status).toBe(404);
  });

  it('403s when the module floor is missing while 039 does not guard the module', async () => {
    perms('page:k3x9q2:view');
    const res = await get('/staff/sell~k3x9q2');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('skips the floor once the module is dataset-enforced', async () => {
    enforced.list = ['pos'];
    perms('page:k3x9q2:view');
    expect((await get('/staff/sell~k3x9q2')).status).toBe(200);
  });

  it('404s for an unknown id, //evil and a missing path', async () => {
    perms('page:k3x9q2:view', 'pos:view');
    expect((await get('/staff/sell~zzzzzz')).status).toBe(404);
    expect((await get('//evil')).status).toBe(404);
    expect((await get()).status).toBe(404);
  });
});
