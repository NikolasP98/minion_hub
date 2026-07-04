import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  submitEntry,
  cancelEntry,
  rebuildBins,
  StockError,
  buildInvoiceIssuePreview,
  createIssueFromInvoice,
  setConsumption,
  createItem,
  updateItem,
} from './stock.service';

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

    // No consumptionUom set on either item — qtyConsumption == qty (identity
    // conversion), matching pre-P5.1b behavior.
    expect(preview.lines).toEqual([
      {
        itemId: 'item_tox',
        itemName: 'Toxina Botulinica',
        itemCode: 'TOX',
        uom: 'unit',
        qty: 60,
        available: 50,
        qtyConsumption: 60,
        consumptionUom: null,
        unitsPerStockUom: null,
        subunitsPerStockUom: null,
        diagramEnabled: false,
      },
      {
        itemId: 'item_derma',
        itemName: 'Dermaquench',
        itemCode: 'DQ',
        uom: 'unit',
        qty: 1,
        available: 0,
        qtyConsumption: 1,
        consumptionUom: null,
        unitsPerStockUom: null,
        subunitsPerStockUom: null,
        diagramEnabled: false,
      },
    ]);
    expect(preview.unmatched).toEqual([
      { description: 'Unknown service', quantity: 1 },
      { description: 'Misc line', quantity: 3 },
    ]);
  });

  it('converts consumption-uom qty to stock-uom qty: 5ml against a 500ml/caja item → 0.01 caja', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'inv1' }], // invoice
      [{ productId: 'p1', description: 'Botox 5ml shot', quantity: '5' }], // invoice items — 5 units of consumption-uom-per-service
      [{ finProductId: 'p1', itemId: 'item_caja', qtyPerUnit: '1' }], // mapping: 1 ml per unit sold
      [], // no 1:1 fallback candidates
      [
        {
          id: 'item_caja',
          name: 'Botox 500ml caja',
          code: 'CJX',
          uom: 'caja',
          consumptionUom: 'ml',
          unitsPerStockUom: '500',
          subunitsPerStockUom: null,
          diagramEnabled: true,
        },
      ], // item detail lookup
      [{ itemId: 'item_caja', qty: '2' }], // bins — 2 cajas available
    ]);

    const preview = await buildInvoiceIssuePreview(ctx(db), 'inv1', 'wh1');

    expect(preview.lines).toEqual([
      {
        itemId: 'item_caja',
        itemName: 'Botox 500ml caja',
        itemCode: 'CJX',
        uom: 'caja',
        qty: 0.01,
        available: 2,
        qtyConsumption: 5,
        consumptionUom: 'ml',
        unitsPerStockUom: 500,
        subunitsPerStockUom: null,
        diagramEnabled: true,
      },
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
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 0 }, actor)).rejects.toMatchObject({
      code: 'invalid_qty',
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects when the item does not exist in this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]); // item lookup empty
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'missing', qtyPerUnit: 1 }, actor)).rejects.toMatchObject({
      code: 'item_not_found',
    });
  });

  it('rejects when the item exists but is not a stock item', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', isStockItem: false }]]);
    await expect(setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 1 }, actor)).rejects.toMatchObject({
      code: 'not_stock_item',
    });
  });

  it('rejects when the fin_product does not exist in this org', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', isStockItem: true }], []]); // item ok, product lookup empty
    await expect(setConsumption(ctx(db), { finProductId: 'missing', itemId: 'i1', qtyPerUnit: 1 }, actor)).rejects.toMatchObject({
      code: 'product_not_found',
    });
  });

  it('upserts a valid mapping', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', isStockItem: true }],
      [{ id: 'p1' }],
      [], // no existing mapping (create)
      [{ id: 'c1', orgId: 'org-1', finProductId: 'p1', itemId: 'i1', qtyPerUnit: '2', note: null }],
    ]);
    const row = await setConsumption(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 2 }, actor);
    expect(row).toMatchObject({ id: 'c1', finProductId: 'p1', itemId: 'i1' });
  });
});

describe('setConsumption — audit trail (§7 audit tracing)', () => {
  beforeEach(() => {
    vi.doUnmock('./activity.service');
  });

  it('records old→new qty_per_unit into doc_audit_log via recordAudit, with the actor', async () => {
    vi.doMock('./activity.service', async () => {
      const actual = await vi.importActual<typeof import('./activity.service')>('./activity.service');
      return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
    });
    // stock.service is already statically imported above (with the real,
    // unmocked activity.service bound in) — force a fresh module graph so this
    // dynamic re-import actually picks up the doMock'd recordAudit.
    vi.resetModules();
    const { setConsumption: setConsumptionSpied } = await import('./stock.service');
    const activity = await import('./activity.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', isStockItem: true }], // item
      [{ id: 'p1' }], // product
      [{ qtyPerUnit: '1' }], // existing mapping: old qty = 1
      [{ id: 'c1', orgId: 'org-1', finProductId: 'p1', itemId: 'i1', qtyPerUnit: '2', note: null }], // upsert result
    ]);

    await setConsumptionSpied(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 2 }, actor);

    expect(activity.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refType: 'stk_consumption',
        refId: 'c1',
        op: 'update',
        changes: [{ field: 'qtyPerUnit', label: 'Qty per unit', old: 1, new: 2 }],
        actor,
      }),
    );
    vi.doUnmock('./activity.service');
  });

  it('emits no audit row when qtyPerUnit is unchanged (e.g. only note patched)', async () => {
    vi.doMock('./activity.service', async () => {
      const actual = await vi.importActual<typeof import('./activity.service')>('./activity.service');
      return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
    });
    // stock.service is already statically imported above (with the real,
    // unmocked activity.service bound in) — force a fresh module graph so this
    // dynamic re-import actually picks up the doMock'd recordAudit.
    vi.resetModules();
    const { setConsumption: setConsumptionSpied } = await import('./stock.service');
    const activity = await import('./activity.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', isStockItem: true }],
      [{ id: 'p1' }],
      [{ qtyPerUnit: '2' }], // existing mapping: same qty
      [{ id: 'c1', orgId: 'org-1', finProductId: 'p1', itemId: 'i1', qtyPerUnit: '2', note: 'updated note' }],
    ]);

    await setConsumptionSpied(ctx(db), { finProductId: 'p1', itemId: 'i1', qtyPerUnit: 2, note: 'updated note' }, actor);

    // recordAudit was called but no-ops on an empty changes array (own db.insert never runs).
    expect(activity.recordAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ changes: [] }));
    vi.doUnmock('./activity.service');
  });
});

describe('createItem — uom cross-field validation', () => {
  it('rejects a consumptionUom without a unitsPerStockUom before touching the db', async () => {
    const { db } = createMockDb();
    await expect(
      createItem(ctx(db), { code: 'C1', name: 'Item', consumptionUom: 'ml', unitsPerStockUom: null }),
    ).rejects.toMatchObject({ code: 'invalid_uom_config' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('allows a consumptionUom paired with a unitsPerStockUom', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', consumptionUom: 'ml', unitsPerStockUom: '500' }]]);
    const row = await createItem(ctx(db), { code: 'C1', name: 'Item', consumptionUom: 'ml', unitsPerStockUom: '500' });
    expect(row).toMatchObject({ id: 'i1' });
  });
});

describe('updateItem — uom cross-field validation (merged against the current row)', () => {
  it('rejects setting consumptionUom via PATCH when neither the patch nor the current row has unitsPerStockUom', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'i1', orgId: 'org-1', consumptionUom: null, unitsPerStockUom: null }]]); // current row
    await expect(updateItem(ctx(db), 'i1', { consumptionUom: 'ml' })).rejects.toMatchObject({ code: 'invalid_uom_config' });
  });

  it('allows setting consumptionUom via PATCH when the current row already has a unitsPerStockUom', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', orgId: 'org-1', consumptionUom: null, unitsPerStockUom: '500' }], // current row
      [{ id: 'i1', orgId: 'org-1', consumptionUom: 'ml', unitsPerStockUom: '500' }], // updated row
    ]);
    const row = await updateItem(ctx(db), 'i1', { consumptionUom: 'ml' });
    expect(row).toMatchObject({ consumptionUom: 'ml' });
  });
});
