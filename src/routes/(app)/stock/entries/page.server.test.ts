import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listEntriesPage: vi.fn(),
  bundle: vi.fn(async () => ({ definitions: [] })),
  legacy: vi.fn(() => {
    throw new Error('legacy unbounded reader used');
  }),
  denied: false,
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: async () => (h.denied ? { denied: 'stock', verb: 'view' } : { tenantId: 'org-1' }),
  isDenied: (c: unknown) => !!c && typeof c === 'object' && 'denied' in c,
}));
vi.mock('$server/services/custom-property-bundle.service', () => ({
  loadCustomPropertyBundle: h.bundle,
}));
vi.mock('$server/services/stock.service', () => ({
  listEntries: h.legacy,
  listItems: h.legacy,
  listWarehouses: h.legacy,
}));
vi.mock('$server/services/attachments.service', () => ({ countAttachmentsByObjects: h.legacy }));
vi.mock('$server/services/stock-entries-read.service', async (original) => ({
  ...(await original<typeof import('$server/services/stock-entries-read.service')>()),
  listEntriesPage: h.listEntriesPage,
  resolveMovementAdmission: async () => ({}),
}));

const { load } = await import('./+page.server');
const { MovementError } = await import('$server/services/stock-entries-read.service');
type Arg = Parameters<typeof load>[0];
const run = (search = '') =>
  load({
    locals: {},
    url: new URL(`http://x/stock/entries${search}`),
    depends: vi.fn(),
  } as unknown as Arg) as Promise<{ stock: Record<string, unknown> }>;

beforeEach(() => {
  h.denied = false;
  h.listEntriesPage.mockReset();
  h.bundle.mockClear();
});

describe('/stock/entries loader', () => {
  it('returns the denied marker without reading anything', async () => {
    h.denied = true;
    const out = await run();
    expect(out.stock).toMatchObject({ denied: 'stock' });
    expect(h.listEntriesPage).not.toHaveBeenCalled();
  });

  it('passes cursor and party through, feeds the bundle only the admitted page ids, never calls legacy readers', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ entryId: `e${i}` }));
    h.listEntriesPage.mockResolvedValue({
      movements: { surface: 'entries', projection: 'full', rows, nextCursor: 'N' },
      warehouseCount: 1,
    });
    const out = await run('?cursor=C&party=P');
    expect(h.listEntriesPage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      cursor: 'C',
      partyId: 'P',
    });
    expect(h.bundle.mock.calls[0][3]).toHaveLength(50);
    expect(out.stock).toMatchObject({ partyFilter: 'P', warehouseCount: 1 });
    expect(out.stock).not.toHaveProperty('entries');
    expect(out.stock).not.toHaveProperty('itemsById');
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('maps a bad cursor to HTTP 400 and snapshot failure to 503', async () => {
    h.listEntriesPage.mockRejectedValueOnce(new MovementError('invalid_cursor', 400));
    await expect(run('?cursor=x')).rejects.toMatchObject({ status: 400 });
    h.listEntriesPage.mockRejectedValueOnce(
      new MovementError('movement_snapshot_unavailable', 503),
    );
    await expect(run()).rejects.toMatchObject({ status: 503 });
  });
});
