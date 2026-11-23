import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recent: vi.fn(),
  legacy: vi.fn(() => {
    throw new Error('getRecentLedger used');
  }),
}));
vi.mock('$server/auth/dataset-ctx', () => ({
  datasetCtx: async () => ({ tenantId: 'org-1' }),
  isDenied: () => false,
}));
vi.mock('$server/services/stock.service', () => ({
  listItems: async () => [],
  listWarehouses: async () => [],
  getBins: async () => [],
  itemOnHandInfo: async () => new Map(),
  getStockDailyFlow: async () => [],
  ledgerValueGaps: async () => [],
  getRecentLedger: h.legacy,
}));
vi.mock('$server/services/stock-entries-read.service', async (original) => ({
  ...(await original<typeof import('$server/services/stock-entries-read.service')>()),
  listRecentMovementRows: h.recent,
  resolveMovementAdmission: async () => ({}),
}));
const { load } = await import('./+page.server');
const { MovementError } = await import('$server/services/stock-entries-read.service');

describe('/stock overview loader', () => {
  it('serves stock.recentMovements (lossless ids) in place of stock.recent and keeps its aggregates', async () => {
    const recentMovements = {
      surface: 'recent',
      projection: 'full',
      rows: [{ ledgerId: '9007199254740993' }],
      nextCursor: null,
    };
    h.recent.mockResolvedValue(recentMovements);
    const out = (await load({ locals: {}, depends: vi.fn() } as never)) as {
      stock: Record<string, unknown>;
    };
    expect(out.stock.recentMovements).toBe(recentMovements);
    expect(out.stock).not.toHaveProperty('recent');
    expect(out.stock).toHaveProperty('series');
    expect(out.stock).toHaveProperty('lowStock');
    expect(out.stock.gaps).toEqual([]);
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('a movement error renders the recent card unavailable instead of failing the page', async () => {
    h.recent.mockRejectedValue(new MovementError('movement_snapshot_unavailable', 503));
    const out = (await load({ locals: {}, depends: vi.fn() } as never)) as {
      stock: { recentMovements: { projection: string; rows: unknown[] } };
    };
    expect(out.stock.recentMovements).toMatchObject({ projection: 'identity_only', rows: [] });
  });
});
