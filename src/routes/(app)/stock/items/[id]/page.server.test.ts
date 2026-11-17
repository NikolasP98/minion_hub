import { describe, expect, it, vi } from 'vitest';

const ITEM = '33333333-3333-4333-8333-333333333333';
const h = vi.hoisted(() => ({
  page: vi.fn(),
  legacy: vi.fn(() => {
    throw new Error('getLedger/listEntryRefs used');
  }),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: async () => ({ tenantId: 'org-1' }),
  isDenied: () => false,
}));
vi.mock('$server/services/stock.service', () => ({
  listItems: async () => [{ id: ITEM, name: 'Faja M', code: 'F', uom: 'und' }],
  listWarehouses: async () => [],
  getBins: async () => [],
  listConsumption: async () => [],
  itemSupplyInfo: async () => new Map(),
  getLedger: h.legacy,
  listEntryRefs: h.legacy,
}));
vi.mock('$server/services/tag-links.service', () => ({
  getInheritedItemTags: async () => new Map(),
}));
vi.mock('$server/services/crm-contacts.service', () => ({ listTags: async () => [] }));
vi.mock('$server/services/party.service', () => ({ getParty: async () => null }));
vi.mock('$server/services/custom-property-bundle.service', () => ({
  loadCustomPropertyBundle: async () => ({}),
}));
vi.mock('$server/services/stock-entries-read.service', async (original) => ({
  ...(await original<typeof import('$server/services/stock-entries-read.service')>()),
  listItemLedgerPage: h.page,
  resolveMovementAdmission: async () => ({}),
}));
const { load } = await import('./+page.server');
const { MovementError } = await import('$server/services/stock-entries-read.service');

const run = (search = '') =>
  load({
    locals: {},
    params: { id: ITEM },
    url: new URL(`http://x/stock/items/${ITEM}${search}`),
    depends: vi.fn(),
  } as never) as Promise<{ stock: Record<string, unknown> }>;

describe('/stock/items/[id] loader', () => {
  it('reads one bounded ledger page via ?ledgerCursor= and returns stock.movements', async () => {
    const movements = { surface: 'item_ledger', projection: 'full', rows: [], nextCursor: null };
    h.page.mockResolvedValue(movements);
    const out = await run('?ledgerCursor=L');
    expect(h.page).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      itemId: ITEM,
      cursor: 'L',
    });
    expect(out.stock.movements).toBe(movements);
    expect(out.stock).not.toHaveProperty('ledger');
    expect(h.legacy).not.toHaveBeenCalled();
  });
  it('a wrong-item cursor is HTTP 400', async () => {
    h.page.mockRejectedValue(new MovementError('invalid_cursor', 400));
    await expect(run('?ledgerCursor=x')).rejects.toMatchObject({ status: 400 });
  });
});
