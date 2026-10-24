import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Spec 039 S2: a POS role reads stock through the STOCK handle, never the POS one. */
const h = vi.hoisted(() => ({
  denied: new Set<string>(),
  listItems: vi.fn(() => Promise.resolve([{ id: 'i1', name: 'Dysport' }])),
  listAllComponentEdges: vi.fn(() => Promise.resolve([])),
}));

vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: (_l: unknown, module: string) =>
    Promise.resolve(
      h.denied.has(module) ? { denied: module, verb: 'view' } : { tenantId: 'org-1', module },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/pos.service', () => ({
  listSellables: () => Promise.resolve([]),
  listBundleEdges: () => Promise.resolve([]),
}));
vi.mock('$server/services/stock.service', () => ({
  listItems: h.listItems,
  listAllComponentEdges: h.listAllComponentEdges,
}));
vi.mock('$server/services/finance-products.service', () => ({
  billingForProducts: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/item-cost.service', () => ({
  costForProducts: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/rbac.service', () => ({
  shouldMaskSensitive: () => Promise.resolve(false),
}));
vi.mock('$server/services/tag-links.service', () => ({
  getTagLinks: () => Promise.resolve(new Map()),
  getProductIngredientTags: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/crm-contacts.service', () => ({ listTags: () => Promise.resolve([]) }));
vi.mock('$server/services/pos-categories.service', () => ({
  listProductCategories: () => Promise.resolve([]),
}));
vi.mock('$server/services/custom-property-bundle.service', () => ({
  loadCustomPropertyBundle: () => Promise.resolve({}),
}));
vi.mock('$server/services/formula-properties.service', () => ({
  formulaInputsFromPosRows: () => ({}),
}));

async function call() {
  const { load } = await import('./+page.server');
  const out = await load({
    locals: { moduleStates: { stock: true } },
    depends: () => {},
  } as unknown as Parameters<typeof load>[0]);
  return (out as { pos: Record<string, unknown> }).pos;
}

beforeEach(() => {
  h.denied.clear();
  vi.clearAllMocks();
});

describe('/pos/catalog +page.server load', () => {
  it('stock denied: stock slots carry the marker and the stock service never runs', async () => {
    h.denied.add('stock');
    const pos = await call();
    expect(pos.stockItems).toEqual({ denied: 'stock', verb: 'view' });
    expect(pos.componentEdges).toEqual({ denied: 'stock', verb: 'view' });
    expect(h.listItems).not.toHaveBeenCalled();
    expect(h.listAllComponentEdges).not.toHaveBeenCalled();
  });

  it('stock allowed: items are read with the stock handle', async () => {
    const pos = await call();
    expect(pos.stockItems).toEqual([{ id: 'i1', name: 'Dysport' }]);
    expect(h.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ module: 'stock' }),
      expect.anything(),
    );
  });
});
