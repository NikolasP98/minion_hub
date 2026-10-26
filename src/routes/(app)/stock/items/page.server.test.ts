import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Spec 039 S3: stock items read tags through the CRM handle, items through the stock handle. */
const h = vi.hoisted(() => ({
  denied: new Set<string>(),
  listItems: vi.fn(() =>
    Promise.resolve([{ id: 'i1', name: 'Dysport', uom: 'UN', reorderLevel: null }]),
  ),
  listTags: vi.fn(() => Promise.resolve([{ id: 't1', name: 'Tox', color: null, kind: 'manual' }])),
  getInheritedItemTags: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: (_l: unknown, module: string) =>
    Promise.resolve(
      h.denied.has(module) ? { denied: module, verb: 'view' } : { tenantId: 'org-1', module },
    ),
  isDenied: (v: unknown) => !!v && typeof v === 'object' && 'denied' in v,
}));
vi.mock('$server/services/stock.service', () => ({
  listItems: h.listItems,
  itemSupplyInfo: () => Promise.resolve(new Map()),
  itemOnHandInfo: () => Promise.resolve(new Map()),
}));
vi.mock('$server/services/stock.logic', () => ({
  isLowStock: () => false,
  distinctUoms: () => ['UN'],
}));
vi.mock('$server/services/tag-links.service', () => ({
  getInheritedItemTags: h.getInheritedItemTags,
}));
vi.mock('$server/services/crm-contacts.service', () => ({ listTags: h.listTags }));
vi.mock('$server/services/custom-property-bundle.service', () => ({
  loadCustomPropertyBundle: () => Promise.resolve({}),
}));

async function call() {
  const { load } = await import('./+page.server');
  const out = await load({
    locals: {},
    depends: () => {},
    url: new URL('http://x/stock/items'),
  } as unknown as Parameters<typeof load>[0]);
  return (out as { stock: Record<string, unknown> }).stock;
}

beforeEach(() => {
  h.denied.clear();
  vi.clearAllMocks();
});

describe('/stock/items +page.server load', () => {
  it('stock denied: the slot is the marker and no stock service runs', async () => {
    h.denied.add('stock');
    expect(await call()).toEqual({ denied: 'stock', verb: 'view' });
    expect(h.listItems).not.toHaveBeenCalled();
    expect(h.listTags).not.toHaveBeenCalled();
  });

  it('crm denied: items load, tag reads are skipped', async () => {
    h.denied.add('crm');
    const stock = await call();
    expect((stock.items as unknown[]).length).toBe(1);
    expect(stock.tags).toEqual([]);
    expect(h.listTags).not.toHaveBeenCalled();
    expect(h.getInheritedItemTags).not.toHaveBeenCalled();
  });

  it('all allowed: tags come through the crm handle', async () => {
    const stock = await call();
    expect(stock.tags).toEqual([{ id: 't1', name: 'Tox', color: null }]);
    expect(h.listTags).toHaveBeenCalledWith(expect.objectContaining({ module: 'crm' }), 'stock');
  });
});
