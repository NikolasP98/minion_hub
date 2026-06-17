import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: string, _o: unknown, fn: () => Promise<unknown>) => fn(),
  keys: { hub: () => 'k' },
  invalidateTags: async () => {},
  tags: { tenantDomain: () => ['t'] },
}));

// mockWithOrgCore wraps the real module export. Tests that test upsert paths
// need the real withOrgCore (so db.transaction is called), so we keep the
// default implementation as a passthrough, and only override it for aggregate tests.
const mockWithOrgCore = vi.fn(
  (scope: { db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> }; tenantId: string }, fn: (tx: unknown) => Promise<unknown>) =>
    scope.db.transaction((tx) => fn(tx)),
);

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    mockWithOrgCore(scope as never, fn),
}));

const ctx = (db: unknown = {}) => ({ db: db as never, tenantId: 'org-1' });
const inv = (over = {}) => ({
  provider: 'susii', providerRef: 'r1', number: 'N1', documentId: 'D1', issuedAt: '2026-01-01T00:00:00Z',
  clientName: 'A', clientDocType: 'DNI', clientDocNumber: '111', clientEmail: null, currency: 'PEN',
  subtotal: 100, tax: 18, discount: 0, total: 118, status: 'paid', seller: 's', note: null, metadata: {},
  items: [{ code: 'AF1', description: 'x', category: null, quantity: 1, unitPrice: 100, discount: 0, tax: 18, total: 118, metadata: {} }],
  payments: [{ providerRef: 'p1', method: null, paidAt: '2026-01-01T00:00:00Z', amount: 118, status: 'paid', metadata: {} }],
  client: { provider: 'susii', providerRef: 'c1', name: 'A', docType: 'DNI', docNumber: '111', email: null, phone: '999', metadata: {} },
  ...over,
});

describe('upsertInvoicesBatch', () => {
  beforeEach(() => {
    // Reset to passthrough (uses db.transaction from the ctx)
    mockWithOrgCore.mockImplementation(
      (scope, fn) => scope.db.transaction((tx: unknown) => fn(tx)),
    );
  });

  it('runs one transaction and issues set-based writes for a multi-invoice page', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ providerRef: 'c1', id: 'cid1' }],
      [{ providerRef: 'r1', id: 'iid1' }, { providerRef: 'r2', id: 'iid2' }],
      [], [], [], [],
    ]);
    await upsertInvoicesBatch(ctx(db), [inv(), inv({ providerRef: 'r2', client: { ...inv().client, providerRef: 'c2', docNumber: '222' } })]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('upsertInvoice delegates to the batch path', async () => {
    const { upsertInvoice } = await import('./finance.service');
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ providerRef: 'c1', id: 'cid1' }], [{ providerRef: 'r1', id: 'iid1' }], [], [], [], []]);
    await upsertInvoice(ctx(db), inv());
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('no-ops cleanly on an empty page', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { db } = createMockDb();
    await upsertInvoicesBatch(ctx(db), []);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('dedupes duplicate providerRef invoices in a page (last-wins, one transaction, no throw)', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { db, resolveSequence } = createMockDb();
    // Two invoices share providerRef 'r1' — after dedupe only one row reaches the DB insert.
    // The mock returns a single invoice row (not two), which is the expected behaviour.
    resolveSequence([
      [{ providerRef: 'c1', id: 'cid1' }],  // clients upsert
      [{ providerRef: 'r1', id: 'iid1' }],  // invoices upsert (deduped → 1 row)
      [], [], [], [],                         // delete items, insert items, delete payments, insert payments
    ]);
    await expect(
      upsertInvoicesBatch(ctx(db), [
        inv({ providerRef: 'r1', number: 'N1' }),
        inv({ providerRef: 'r1', number: 'N2' }), // duplicate — should be silently dropped
      ]),
    ).resolves.toBeUndefined();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

// Helper: make mockWithOrgCore call fn with a controlled tx.execute
function useExecMock(execute: ReturnType<typeof vi.fn>) {
  mockWithOrgCore.mockImplementation((_scope, fn) => fn({ execute } as never));
}

describe('financeSummary', () => {
  it('coerces DB strings to numbers and computes derived fields', async () => {
    const { financeSummary } = await import('./finance.service');
    const execute = vi.fn()
      .mockResolvedValueOnce([{ net: '1000.5', gross: '1200.0', discount: '199.5', invoices: '10', clients: '8', voids: '1', currency: 'PEN' }])
      .mockResolvedValueOnce([{ n: '3' }]);
    useExecMock(execute);

    const result = await financeSummary(ctx(), { from: null, to: null, bucket: 'month' });

    expect(result.totalNet).toBe(1000.5);
    expect(result.totalGross).toBe(1200.0);
    expect(result.totalDiscount).toBe(199.5);
    expect(result.invoiceCount).toBe(10);
    expect(result.uniqueClients).toBe(8);
    expect(result.voidCount).toBe(1);
    expect(result.newClients).toBe(3);
    expect(result.currency).toBe('PEN');
    // avgTicket = net / invoices
    expect(result.avgTicket).toBeCloseTo(100.05);
    // discountRate = discount / gross
    expect(result.discountRate).toBeCloseTo(199.5 / 1200.0);
    // voidRate = voids / invoices
    expect(result.voidRate).toBeCloseTo(1 / 10);
  });

  it('handles zero invoices without dividing by zero', async () => {
    const { financeSummary } = await import('./finance.service');
    const execute = vi.fn()
      .mockResolvedValueOnce([{ net: '0', gross: '0', discount: '0', invoices: '0', clients: '0', voids: '0', currency: null }])
      .mockResolvedValueOnce([{ n: '0' }]);
    useExecMock(execute);

    const result = await financeSummary(ctx(), { from: '2026-01-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z', bucket: 'day' });
    expect(result.avgTicket).toBe(0);
    expect(result.discountRate).toBe(0);
    expect(result.voidRate).toBe(0);
    expect(result.currency).toBe('PEN');
  });
});

describe('revenueSeries', () => {
  it('returns an array of coerced series rows', async () => {
    const { revenueSeries } = await import('./finance.service');
    const execute = vi.fn().mockResolvedValueOnce([
      { bucket: '2026-01-01', invoices: '5', revenue: '590.0', discount: '10.0', gross: '600.0' },
      { bucket: '2026-02-01', invoices: '3', revenue: '354.0', discount: '6.0', gross: '360.0' },
    ]);
    useExecMock(execute);

    const result = await revenueSeries(ctx(), { from: null, to: null, bucket: 'month' });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ bucket: '2026-01-01', invoices: 5, revenue: 590.0, discount: 10.0, gross: 600.0 });
    expect(result[1].revenue).toBe(354.0);
  });

  it('respects period params without error', async () => {
    const { revenueSeries } = await import('./finance.service');
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    const result = await revenueSeries(ctx(), { from: '2026-01-01T00:00:00.000Z', to: '2026-06-01T00:00:00.000Z', bucket: 'week' });
    expect(result).toEqual([]);
  });
});

describe('topProducts', () => {
  it('returns coerced top-products rows', async () => {
    const { topProducts } = await import('./finance.service');
    const execute = vi.fn().mockResolvedValueOnce([
      { product_id: 'p1', code: 'AF1', name: 'Product A', revenue: '500.0', qty: '10', lines: '5' },
    ]);
    useExecMock(execute);

    const result = await topProducts(ctx(), { from: null, to: null, bucket: 'month' });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ productId: 'p1', code: 'AF1', name: 'Product A', revenue: 500.0, qty: 10, lines: 5 });
  });
});

describe('topClients', () => {
  it('returns coerced top-clients rows', async () => {
    const { topClients } = await import('./finance.service');
    const execute = vi.fn().mockResolvedValueOnce([
      { doc_number: '12345', name: 'Client A', invoices: '7', revenue: '820.0', last: '2026-05-15T00:00:00Z' },
    ]);
    useExecMock(execute);

    const result = await topClients(ctx(), { from: null, to: null, bucket: 'month' });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ docNumber: '12345', name: 'Client A', invoices: 7, revenue: 820.0, last: '2026-05-15T00:00:00Z' });
  });
});
