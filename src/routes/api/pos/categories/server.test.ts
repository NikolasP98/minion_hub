import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ctx: { db: {}, tenantId: 'org-1' } as { db: object; tenantId: string } | null,
  enabled: true,
  required: vi.fn(),
  list: vi.fn(async () => [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Service', color: '#3b82f6' },
  ]),
  create: vi.fn(async () => ({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'New',
    color: '#10b981',
  })),
}));

vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: () => Promise.resolve(state.ctx) }));
vi.mock('$server/services/modules.service', () => ({
  isModuleEnabled: () => Promise.resolve(state.enabled),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: (...args: unknown[]) => state.required(...args),
}));
vi.mock('$server/services/pos-categories.service', () => ({
  listProductCategories: () => state.list(),
  createProductCategory: (_ctx: unknown, input: unknown) => state.create(input),
  ProductCategoryError: class ProductCategoryError extends Error {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx = { db: {}, tenantId: 'org-1' };
  state.enabled = true;
});

describe('/api/pos/categories', () => {
  it('GET requires pos:view and returns the options', async () => {
    const { GET } = await import('./+server');
    const response = await GET({ locals: {} } as never);
    expect(state.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'view');
    expect(await response.json()).toEqual({ categories: await state.list() });
  });

  it('POST requires pos:edit and trims a new name', async () => {
    const { POST } = await import('./+server');
    const response = await POST({
      locals: {},
      request: new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '  New  ', color: '#10b981' }),
      }),
    } as never);
    expect(response.status).toBe(201);
    expect(state.required).toHaveBeenCalledWith(expect.anything(), 'pos', 'edit');
    expect(state.create).toHaveBeenCalledWith({ name: 'New', color: '#10b981' });
  });

  it('returns 401 before RBAC without an authenticated org context', async () => {
    state.ctx = null;
    const { GET } = await import('./+server');
    await expect(GET({ locals: {} } as never)).rejects.toMatchObject({ status: 401 });
    expect(state.required).not.toHaveBeenCalled();
  });

  it('hides the endpoint when POS is disabled', async () => {
    state.enabled = false;
    const { GET } = await import('./+server');
    await expect(GET({ locals: {} } as never)).rejects.toMatchObject({ status: 404 });
    expect(state.required).not.toHaveBeenCalled();
  });
});
