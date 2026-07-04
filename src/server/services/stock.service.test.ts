import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { submitEntry, cancelEntry, rebuildBins, StockError, buildInvoiceIssuePreview, createIssueFromInvoice, setConsumption } from './stock.service';

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

describe('buildInvoiceIssuePreview — aggregation, 1:1 fallback, dedupe, unmatched', () => {
  it('sums mapped lines, applies the 1:1 fallback only where no mapping exists, and reports unmatched', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'inv1' }], // invoice
      [
        { productId: 'p1', description: 'Botox', quantity: '2' }, // mapped (p1 -> item_tox, x30)
        { productId: 'p2', description: 'Dermaquench', quantity: '1' }, // no mapping, 1:1 fallback
        { productId: 'p3', description: 'Unknown service', quantity: '1' }, // neither path
        { productId: null, description: 'Misc line', quantity: '3' }, // no product link at all
      ], // invoice items
      [{ finProductId: 'p1', itemId: 'item_tox', qtyPerUnit: '30' }], // stk_consumption mapping rows
      [
        { id: 'item_tox_retail', finProductId: 'p1' }, // decoy: p1 already mapped — must be ignored (dedupe)
        { id: 'item_derma', finProductId: 'p2' },
      ], // 1:1 fallback candidates
      [
        { id: 'item_tox', name: 'Toxina Botulinica', code: 'TOX', uom: 'unit' },
        { id: 'item_derma', name: 'Dermaquench', code: 'DQ', uom: 'unit' },
      ], // item detail lookup
      [{ itemId: 'item_tox', qty: '50' }], // bins (item_derma has no bin row -> available 0)
    ]);

    const preview = await buildInvoiceIssuePreview(ctx(db), 'inv1', 'wh1');

    expect(preview.lines).toEqual([
      { itemId: 'item_tox', itemName: 'Toxina Botulinica', itemCode: 'TOX', uom: 'unit', qty: 60, available: 50 },
      { itemId: 'item_derma', itemName: 'Dermaquench', itemCode: 'DQ', uom: 'unit', qty: 1, available: 0 },
    ]);
    expect(preview.unmatched).toEqual([
      { description: 'Unknown service', quantity: 1 },
      { description: 'Misc line', quantity: 3 },
    ]);
  });

  it('rejects a preview for an invoice not in this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // invoice lookup empty
    await expect(buildInvoiceIssuePreview(ctx(db), 'missing', 'wh1')).rejects.toMatchObject({ code: 'invoice_not_found' });
  });
});

describe('createIssueFromInvoice — duplicate guard + happy path', () => {
  it('refuses a second issue for an invoice that already has a non-cancelled entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'inv1', providerRef: 'REF-1' }], // invoice
      [{ id: 'existing-entry' }], // duplicate check hits
    ]);
    await expect(
      createIssueFromInvoice(ctx(db), { invoiceId: 'inv1', warehouseId: 'wh1', lines: [{ itemId: 'item1', qty: 5 }], actor }),
    ).rejects.toMatchObject({ code: 'duplicate_invoice' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('rejects with no_lines before touching the db when lines is empty', async () => {
    const { db } = createMockDb();
    await expect(createIssueFromInvoice(ctx(db), { invoiceId: 'inv1', warehouseId: 'wh1', lines: [], actor })).rejects.toMatchObject({
      code: 'no_lines',
    });
  });

  it('creates a draft issue entry stamped with the invoice metadata when no duplicate exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'inv1', providerRef: 'REF-1' }], // invoice
      [], // no duplicate
      [{ id: 'entry1', orgId: 'org-1', type: 'issue', status: 'draft' }], // stk_entries insert
      [], // stk_entry_lines insert
    ]);
    const entry = await createIssueFromInvoice(ctx(db), {
      invoiceId: 'inv1',
      warehouseId: 'wh1',
      lines: [{ itemId: 'item1', qty: 5 }],
      actor,
    });
    expect(entry).toMatchObject({ id: 'entry1', status: 'draft', type: 'issue' });
  });
});

describe('setConsumption — validation', () => {
  it('rejects a non-positive qtyPerUnit before touching the db', async () => {
    const { db } = createMockDb();
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 0 })).rejects.toMatchObject({ code: 'invalid_qty' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects when the item does not exist in this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // item lookup empty
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'missing', qtyPerUnit: 1 })).rejects.toMatchObject({
      code: 'item_not_found',
    });
  });

  it('rejects when the item exists but is not a stock item', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', isStockItem: false }]]);
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 1 })).rejects.toMatchObject({
      code: 'not_stock_item',
    });
  });

  it('rejects when the fin_product does not exist in this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', isStockItem: true }], []]); // item ok, product lookup empty
    await expect(setConsumption(ctx(db), { finProductId: 'missing', itemId: 'i1', qtyPerUnit: 1 })).rejects.toMatchObject({
      code: 'product_not_found',
    });
  });

  it('upserts a valid mapping', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', isStockItem: true }],
      [{ id: 'p1' }],
      [{ id: 'c1', orgId: 'org-1', finProductId: 'p1', itemId: 'i1', qtyPerUnit: '2', note: null }],
    ]);
    const row = await setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 2 });
    expect(row).toMatchObject({ id: 'c1', finProductId: 'p1', itemId: 'i1' });
  });
});
