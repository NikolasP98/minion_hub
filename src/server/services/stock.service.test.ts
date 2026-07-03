import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { submitEntry, cancelEntry, rebuildBins, StockError } from './stock.service';

beforeEach(() => {
  vi.clearAllMocks();
});

// pg rows are typed for PostgresJsDatabase; the mock db is structural — cast.
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const actor = { id: 'u1', name: 'Test User' };

describe('submitEntry — guards', () => {
  it('blocks a double-submit: an already-submitted entry is rejected before touching lines/bins', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'e1', orgId: 'org-1', status: 'submitted', type: 'issue', humanId: 'STE-2026-00001' }]]);
    await expect(submitEntry(ctx(db), 'e1', actor)).rejects.toMatchObject({ code: 'not_draft' });
  });

  it('rejects a submit for a missing entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    await expect(submitEntry(ctx(db), 'missing', actor)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('enforces the negative-stock guard end-to-end: an issue larger than the bin is rejected before any ledger/bin write', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: null }], // entry (for update)
      [{ id: 'l1', entryId: 'e1', itemId: 'i1', qty: '10', uom: null, rate: null, fromWarehouseId: 'w1', toWarehouseId: null, lineNo: 0 }], // lines
      [{ id: 'i1' }], // item existence
      [{ id: 'w1' }], // warehouse existence
      [{ qty: '2', valuationRate: '1' }], // locked bin: only 2 in stock, issuing 10
    ]);
    await expect(submitEntry(ctx(db), 'e1', actor)).rejects.toMatchObject({ code: 'negative_stock' });
    // Guard fires before the ledger insert / bins upsert.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects an entry with no lines', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: null }],
      [], // no lines
    ]);
    await expect(submitEntry(ctx(db), 'e1', actor)).rejects.toMatchObject({ code: 'no_lines' });
  });
});

describe('cancelEntry — guards', () => {
  it('rejects cancelling a draft (only submitted entries can be cancelled)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'receipt' }]]);
    await expect(cancelEntry(ctx(db), 'e1', actor)).rejects.toMatchObject({ code: 'not_submitted' });
  });

  it('rejects cancelling an already-cancelled entry (idempotent — cannot double-cancel)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'e1', orgId: 'org-1', status: 'cancelled', type: 'receipt' }]]);
    await expect(cancelEntry(ctx(db), 'e1', actor)).rejects.toMatchObject({ code: 'not_submitted' });
  });

  it('rejects a missing entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    await expect(cancelEntry(ctx(db), 'missing', actor)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('rebuildBins — recovery path', () => {
  it('replays the ledger and rewrites bins from it (delete-then-reinsert, scoped to the org)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 3, itemId: 'i1', warehouseId: 'w1', qtyAfter: '15', valuationRate: '10' }], // ledger rows
      [], // delete stk_bins
      [], // insert the single replayed bin
    ]);
    const result = await rebuildBins(ctx(db));
    expect(result).toEqual({ itemsAffected: 1, binsWritten: 1 });
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('an org with no ledger history rebuilds to zero bins', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // ledger rows, delete
    const result = await rebuildBins(ctx(db));
    expect(result).toEqual({ itemsAffected: 0, binsWritten: 0 });
  });
});

describe('StockError', () => {
  it('carries a machine-readable code alongside the message', () => {
    const e = new StockError('boom', 'negative_stock');
    expect(e.code).toBe('negative_stock');
    expect(e.name).toBe('StockError');
    expect(e).toBeInstanceOf(Error);
  });
});
