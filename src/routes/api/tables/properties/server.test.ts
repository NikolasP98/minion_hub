import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireCoreCtx: vi.fn(),
  requireAccess: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  archive: vi.fn(),
  update: vi.fn(),
  loadFormulaCatalog: vi.fn(),
}));
vi.mock('$server/services/formula-properties.service', () => ({
  loadFormulaCatalog: mocks.loadFormulaCatalog,
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: mocks.requireCoreCtx }));
vi.mock('$server/services/custom-properties-access', () => ({
  requireCustomPropertyAccess: mocks.requireAccess,
}));
vi.mock('$server/services/custom-properties.service', () => ({
  createCustomProperty: mocks.create,
  listCustomProperties: mocks.list,
  getCustomProperty: mocks.get,
  setCustomPropertyArchived: mocks.archive,
  updateCustomProperty: mocks.update,
  CustomPropertyError: class extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
}));

import { POST } from './+server';
import { DELETE, PATCH } from './[id]/+server';

describe('custom property definitions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCoreCtx.mockResolvedValue({ tenantId: 'org-1', profileId: 'user-1', db: {} });
    mocks.requireAccess.mockResolvedValue({ canManage: true, canEdit: true });
    mocks.list.mockResolvedValue([]);
    mocks.loadFormulaCatalog.mockImplementation(async (_locals, _ctx, _tableId, definitions) => ({
      fields: [],
      definitions,
      restrictedDefinitionIds: new Set(),
      unavailableDefinitionIds: new Set(),
      canonicalNativeSources: [],
      currency: null,
    }));
  });

  it('rejects malformed rules at the boundary instead of reaching the service', async () => {
    const request = new Request('http://localhost/api/tables/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: 'pos.catalog',
        label: 'Tier',
        rules: { type: 'select' },
        hasDefault: false,
      }),
    });
    await expect(POST({ locals: {}, request } as never)).rejects.toMatchObject({ status: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns the created definition with 201', async () => {
    const definition = {
      id: 'p1',
      version: 1,
      rules: { type: 'boolean' },
      presentation: null,
    };
    mocks.create.mockResolvedValue(definition);
    const request = new Request('http://localhost/api/tables/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: 'pos.catalog',
        label: 'VIP',
        rules: { type: 'boolean' },
        hasDefault: true,
        defaultValue: false,
      }),
    });
    const response = await POST({ locals: {}, request } as never);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ definition });
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      expect.anything(),
      'pos.catalog',
      'manage',
    );
  });

  it('returns the manager legacy editor projection on a v1 formula create', async () => {
    const id = '00000000-0000-4000-8000-000000000031';
    const rules = {
      type: 'formula' as const,
      expression: '1',
      languageVersion: 1 as const,
      ast: { kind: 'literal' as const, value: 1, valueType: 'number' as const, from: 0, to: 1 },
      outputType: {
        kind: 'number' as const,
        dimension: 'unitless' as const,
        currency: null,
        basis: null,
        nullable: false,
      },
      dependencies: [],
    };
    const definition = {
      id,
      tableId: 'pos.catalog',
      label: 'Legacy formula',
      description: null,
      type: 'formula',
      rules,
      hasDefault: false,
      defaultValue: null,
      presentation: null,
      version: 1,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    mocks.create.mockResolvedValue(definition);
    mocks.list.mockResolvedValueOnce([]).mockResolvedValueOnce([definition]);
    const request = new Request('http://localhost/api/tables/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: 'pos.catalog',
        label: definition.label,
        rules,
        catalogRevision: 'revision',
        hasDefault: false,
      }),
    });
    const response = await POST({ locals: {}, request } as never);
    expect(response.status).toBe(201);
    expect((await response.json()).definition.formulaEditor).toMatchObject({
      state: 'ready',
      sourceVersion: 1,
      rules: { type: 'formula', version: 2, variables: [{ name: null, expression: '1' }] },
    });
  });

  it('requires a catalog revision for presentation-only mutations', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    mocks.get.mockResolvedValue({ id, tableId: 'pos.catalog' });
    const request = new Request(`http://localhost/api/tables/properties/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: 'pos.catalog',
        expectedVersion: 1,
        presentation: {
          version: 1,
          number: {
            style: 'decimal',
            decimals: 2,
            currencyDisplay: 'symbol',
            percentScale: 'whole',
          },
          tone: 'none',
          secondary: null,
        },
      }),
    });

    await expect(PATCH({ locals: {}, request, params: { id } } as never)).rejects.toMatchObject({
      status: 409,
      body: { message: 'catalog_changed' },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])(
    'authorizes the declared table before uniformly rejecting a malformed %s id',
    async (method, handler) => {
      const request = new Request('http://localhost/api/tables/properties/not-a-uuid', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tableId: 'pos.catalog', expectedVersion: 1 }),
      });

      await expect(
        handler({ locals: {}, request, params: { id: 'not-a-uuid' } } as never),
      ).rejects.toMatchObject({ status: 404, body: { message: 'property_unavailable' } });
      expect(mocks.requireAccess).toHaveBeenCalledWith(
        {},
        expect.anything(),
        'pos.catalog',
        'manage',
      );
      expect(mocks.get).not.toHaveBeenCalled();
    },
  );
});
