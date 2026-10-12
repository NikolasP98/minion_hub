import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  required: vi.fn(),
  update: vi.fn(async (_ctx: unknown, _id: string, _patch: unknown, _expected?: Date) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Renamed',
    color: '#3b82f6',
    updatedAt: new Date('2026-06-02T00:00:00Z'),
  })),
  remove: vi.fn(async (_ctx: unknown, _id: string) => true),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(true),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('$server/services/pos-categories.service', () => ({
  updateProductCategory: (ctx: unknown, id: string, patch: unknown, expected?: Date) =>
    state.update(ctx, id, patch, expected),
  deleteProductCategory: (ctx: unknown, id: string) => state.remove(ctx, id),
  ProductCategoryError: class ProductCategoryError extends Error {},
}));

beforeEach(() => vi.clearAllMocks());

describe('/api/pos/categories/[id]', () => {
  it('rejects a malformed id without querying the service', async () => {
    const { PATCH } = await import('./+server');
    await expect(
      PATCH({
        locals: {},
        params: { id: 'not-a-uuid' },
        request: new Request('http://x'),
      } as never),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.update).not.toHaveBeenCalled();
  });

  it('PATCH threads a fresh expectedUpdatedAt and answers the new token', async () => {
    const { PATCH } = await import('./+server');
    const id = '11111111-1111-4111-8111-111111111111';
    const res = await PATCH({
      locals: {},
      params: { id },
      request: new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', expectedUpdatedAt: '2026-06-01T00:00:00.000Z' }),
      }),
    } as never);
    expect(res.status).toBe(200);
    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      id,
      { name: 'Renamed' },
      new Date('2026-06-01T00:00:00.000Z'),
    );
    expect((await res.json()).category.updatedAt).toBe('2026-06-02T00:00:00.000Z');
  });

  it('PATCH answers 409 { error: stale, current } for a stale token', async () => {
    const { StaleWriteError } = await import('$server/services/errors');
    const current = { id: 'c1', name: 'Theirs', color: '#3b82f6' };
    state.update.mockRejectedValueOnce(new StaleWriteError(current));
    const { PATCH } = await import('./+server');
    const res = await PATCH({
      locals: {},
      params: { id: '11111111-1111-4111-8111-111111111111' },
      request: new Request('http://x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Mine', expectedUpdatedAt: '2020-01-01T00:00:00Z' }),
      }),
    } as never);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stale', current });
  });

  it('DELETE requires pos:edit and removes only the scoped UUID', async () => {
    const { DELETE } = await import('./+server');
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await DELETE({ locals: {}, params: { id } } as never);
    expect(response.status).toBe(204);
    expect(state.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'edit');
    expect(state.remove).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'org-1' }), id);
  });
});
