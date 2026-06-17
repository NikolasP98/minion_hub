import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { upsertInvoicesBatch, upsertInvoice } from './finance.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
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
  it('runs one transaction and issues set-based writes for a multi-invoice page', async () => {
    const { db, resolveSequence } = createMockDb();
    // client upsert returning, invoice upsert returning, then deletes/inserts resolve to []
    resolveSequence([
      [{ providerRef: 'c1', id: 'cid1' }],            // clients upsert returning
      [{ providerRef: 'r1', id: 'iid1' }, { providerRef: 'r2', id: 'iid2' }], // invoices upsert returning
      [], [], [], [],                                  // delete items, insert items, delete payments, insert payments
    ]);
    await upsertInvoicesBatch(ctx(db), [inv(), inv({ providerRef: 'r2', client: { ...inv().client, providerRef: 'c2', docNumber: '222' } })]);
    expect(db.transaction).toHaveBeenCalledTimes(1); // ONE tx for the whole page
  });

  it('upsertInvoice delegates to the batch path', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ providerRef: 'c1', id: 'cid1' }], [{ providerRef: 'r1', id: 'iid1' }], [], [], [], []]);
    await upsertInvoice(ctx(db), inv());
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('no-ops cleanly on an empty page', async () => {
    const { db } = createMockDb();
    await upsertInvoicesBatch(ctx(db), []);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
