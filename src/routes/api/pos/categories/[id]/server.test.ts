import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  required: vi.fn(),
  update: vi.fn(async (_ctx: unknown, _id: string, _patch: unknown) => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Renamed',
    color: '#3b82f6',
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
  updateProductCategory: (ctx: unknown, id: string, patch: unknown) => state.update(ctx, id, patch),
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

  it('DELETE requires pos:edit and removes only the scoped UUID', async () => {
    const { DELETE } = await import('./+server');
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await DELETE({ locals: {}, params: { id } } as never);
    expect(response.status).toBe(204);
    expect(state.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'edit');
    expect(state.remove).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'org-1' }), id);
  });
});
