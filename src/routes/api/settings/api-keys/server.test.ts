import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireOrgCapability: vi.fn(),
  requireCoreCtx: vi.fn(),
  createKey: vi.fn(),
  listKeys: vi.fn(),
  revokeKey: vi.fn(),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: mocks.requireOrgCapability,
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: mocks.requireCoreCtx }));
vi.mock('$server/services/org-api-keys.service', async (orig) => {
  const real = await orig<typeof import('$server/services/org-api-keys.service')>();
  return {
    ApiKeyError: real.ApiKeyError,
    createKey: mocks.createKey,
    listKeys: mocks.listKeys,
    revokeKey: mocks.revokeKey,
  };
});

import { ApiKeyError } from '$server/services/org-api-keys.service';
import { GET, POST } from './+server';
import { DELETE } from './[id]/+server';

const ctx = { tenantId: 'org-1' };
const locals = { user: { id: 'u1', role: 'user' }, tenantCtx: { tenantId: 'org-1' } };
const KEY = {
  id: 'k1',
  name: 'Site',
  prefix: '1a2b3c4d',
  createdAt: '2026-11-16T10:00:00.000Z',
  createdByName: 'Ada',
  lastUsedAt: null,
  revokedAt: null,
  revokedByName: null,
  scopes: [],
};
const post = (body: string) =>
  POST({
    locals,
    request: new Request('http://hub.test/api/settings/api-keys', { method: 'POST', body }),
  } as never) as Promise<Response>;
const del = (id: string) => DELETE({ locals, params: { id } } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrgCapability.mockResolvedValue(null);
  mocks.requireCoreCtx.mockResolvedValue(ctx);
});

describe('/api/settings/api-keys', () => {
  it('GET lists the keys for settings:manage', async () => {
    mocks.listKeys.mockResolvedValue([KEY]);
    const res = (await GET({ locals } as never)) as Response;
    expect(await res.json()).toEqual({ keys: [KEY] });
    expect(mocks.requireOrgCapability).toHaveBeenCalledWith(locals, 'settings', 'manage');
    expect(mocks.listKeys).toHaveBeenCalledWith(ctx);
  });

  it('POST creates a key → 201 with the text once', async () => {
    mocks.createKey.mockResolvedValue({ ...KEY, key: 'mk_1a2b3c4d_x' });
    const res = await post(JSON.stringify({ name: 'Site' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...KEY, key: 'mk_1a2b3c4d_x' });
    expect(mocks.createKey).toHaveBeenCalledWith(ctx, 'Site', []);
  });

  it('POST passes the requested scopes to the service', async () => {
    mocks.createKey.mockResolvedValue({ ...KEY, scopes: ['sandbox'], key: 'mk_1a2b3c4d_x' });
    await post(JSON.stringify({ name: 'Agent', scopes: ['sandbox'] }));
    expect(mocks.createKey).toHaveBeenCalledWith(ctx, 'Agent', ['sandbox']);
  });

  it('POST passes the locks scope through (spec 140)', async () => {
    mocks.createKey.mockResolvedValue({ ...KEY, scopes: ['locks'], key: 'mk_1a2b3c4d_x' });
    await post(JSON.stringify({ name: 'Accounting', scopes: ['locks'] }));
    expect(mocks.createKey).toHaveBeenCalledWith(ctx, 'Accounting', ['locks']);
  });

  it('POST maps refusals: bad name or body → 400 invalid_name, the eleventh key → 409', async () => {
    mocks.createKey.mockImplementation(async (_c, name: string) => {
      throw new ApiKeyError(name.trim() ? 'limit_reached' : 'invalid_name');
    });
    for (const body of ['not json', '{}', JSON.stringify({ name: 7 })]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_name' });
    }
    const res = await post(JSON.stringify({ name: 'Eleven' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'limit_reached' });
  });

  it('DELETE revokes; unknown id → 404 not_found', async () => {
    mocks.revokeKey.mockResolvedValueOnce(undefined);
    const ok = await del('k1');
    expect(await ok.json()).toEqual({ ok: true });
    expect(mocks.revokeKey).toHaveBeenCalledWith(ctx, 'k1');
    mocks.revokeKey.mockRejectedValueOnce(new ApiKeyError('not_found'));
    const missing = await del('nope');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not_found' });
  });

  it('a role without settings:manage is refused (403) before any read or write', async () => {
    mocks.requireOrgCapability.mockRejectedValue({ status: 403 });
    await expect(GET({ locals } as never)).rejects.toMatchObject({ status: 403 });
    await expect(post(JSON.stringify({ name: 'Site' }))).rejects.toMatchObject({ status: 403 });
    await expect(del('k1')).rejects.toMatchObject({ status: 403 });
    expect(mocks.listKeys).not.toHaveBeenCalled();
    expect(mocks.createKey).not.toHaveBeenCalled();
    expect(mocks.revokeKey).not.toHaveBeenCalled();
  });
});
