import { describe, it, expect, vi } from 'vitest';
import { finInvoices, finClients } from '$server/db/pg-finance-schema';
import { docAuditLog } from '$server/db/pg-activity-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import type { CanonicalInvoice } from '$server/finance/connector';

/**
 * Hand-rolled tx mock (not the generic createMockDb() chain proxy — that proxy
 * mints a fresh vi.fn() on every `.values(...)` access, so it can't capture
 * *what* was inserted, only that `insert` was called). Same technique as
 * gateway.pg.service.test.ts: stable vi.fn()s keyed by real table-object
 * identity (imported from the same schema modules the services use), so
 * `table === finInvoices` etc. just works without mocking the schema.
 */
function buildTx(opts: { existingInvoices?: Array<{ id: string; documentId: string }> } = {}) {
  const insertCalls: Array<{ table: unknown; rows: unknown[] }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: (rows: unknown[]) => {
      insertCalls.push({ table, rows });
      if (table === finInvoices) {
        const out = (rows as Array<{ providerRef: string }>).map((r, i) => ({
          providerRef: r.providerRef,
          id: `inv-${i}`,
          inserted: true, // no pre-existing rows in this test — every upsert is a create
        }));
        return { onConflictDoUpdate: () => ({ returning: () => Promise.resolve(out) }) };
      }
      if (table === finClients) {
        const out = (rows as Array<{ providerRef: string }>).map((r, i) => ({
          providerRef: r.providerRef,
          id: `cli-${i}`,
        }));
        return { onConflictDoUpdate: () => ({ returning: () => Promise.resolve(out) }) };
      }
      return Promise.resolve(undefined);
    },
  }));
  const del = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
  const execute = vi.fn().mockResolvedValue(undefined);
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(opts.existingInvoices ?? []) }),
  }));
  const update = vi.fn(() => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve([{ id: 'c1', displayName: 'Jane' }]) }),
    }),
  }));
  return { tx: { insert, delete: del, execute, select, update }, insertCalls };
}

function ctxWithTx(tx: unknown) {
  return {
    db: { transaction: (cb: (t: unknown) => unknown) => cb(tx) },
    tenantId: 'org-1',
  } as never;
}

function invoiceFixture(overrides: Partial<CanonicalInvoice> = {}): CanonicalInvoice {
  return {
    provider: 'susii',
    providerRef: 'INV-1',
    number: 'F001-1',
    documentId: null,
    issuedAt: null,
    clientName: null,
    clientDocType: null,
    clientDocNumber: null,
    clientEmail: null,
    currency: 'PEN',
    subtotal: null,
    tax: null,
    discount: null,
    total: 100,
    status: 'paid',
    seller: null,
    note: null,
    metadata: {},
    items: [],
    payments: [],
    client: null,
    ...overrides,
  };
}

describe('finance audit (§B.1)', () => {
  it('upsertInvoicesBatch writes a docAuditLog row with actorName connector:<provider>', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { tx, insertCalls } = buildTx();
    await upsertInvoicesBatch(ctxWithTx(tx), [invoiceFixture()]);

    const auditCall = insertCalls.find((c) => c.table === docAuditLog);
    expect(auditCall).toBeTruthy();
    const rows = auditCall!.rows as Array<{
      refType: string;
      refId: string;
      op: string;
      actorName: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].refType).toBe('fin_invoice');
    expect(rows[0].op).toBe('create');
    expect(rows[0].actorName.startsWith('connector:')).toBe(true);
    expect(rows[0].actorName).toBe('connector:susii');
  });

  it('repeatedly overlays a SUNAT source onto the matching SUSII invoice without replacing its items', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { tx, insertCalls } = buildTx({
      existingInvoices: [{ id: 'susii-inv-1', documentId: 'F001-1' }],
    });

    const incoming = invoiceFixture({
      provider: 'sunat-sire',
      providerRef: 'sunat-car-1',
      documentId: 'F001-1',
      metadata: { codCar: 'sunat-car-1' },
    });
    await upsertInvoicesBatch(ctxWithTx(tx), [incoming]);
    await upsertInvoicesBatch(ctxWithTx(tx), [incoming]);

    expect(insertCalls.find((c) => c.table === finInvoices)).toBeUndefined();
    expect(tx.delete).not.toHaveBeenCalled();
    const auditCall = insertCalls.find((c) => c.table === docAuditLog);
    expect(auditCall?.rows).toEqual([
      expect.objectContaining({
        refType: 'fin_invoice',
        refId: 'susii-inv-1',
        op: 'update',
        actorName: 'connector:sunat-sire',
      }),
    ]);
  });

  it('inserts only unmatched SUNAT documents from a mixed page', async () => {
    const { upsertInvoicesBatch } = await import('./finance.service');
    const { tx, insertCalls } = buildTx({
      existingInvoices: [{ id: 'susii-inv-1', documentId: 'F001-1' }],
    });

    await upsertInvoicesBatch(ctxWithTx(tx), [
      invoiceFixture({
        provider: 'sunat-sire',
        providerRef: 'sunat-car-1',
        documentId: 'F001-1',
      }),
      invoiceFixture({
        provider: 'sunat-sire',
        providerRef: 'sunat-car-2',
        documentId: 'F001-2',
      }),
    ]);

    const invoiceCall = insertCalls.find((c) => c.table === finInvoices);
    expect(invoiceCall?.rows).toEqual([
      expect.objectContaining({ providerRef: 'sunat-car-2', documentId: 'F001-2' }),
    ]);
  });
});

describe('crm contacts audit (§B.2)', () => {
  /**
   * ctxWithTx, plus a count of how many times the service opened a top-level
   * transaction. `updateContact` must open exactly ONE: its audit row is
   * written with `recordAuditInTx(tx, ...)` on the transaction that already
   * holds the contact's row lock, not with `recordAudit(ctx, ...)` (which opens
   * a SECOND `withOrgCore` transaction and therefore checks a second connection
   * out of the pool). On a pool with no free slot that nesting self-deadlocks:
   * the inner transaction waits for a connection the outer one cannot release
   * until the inner one returns — demonstrated against real PostgreSQL by
   * `crm-funnel.concurrent.integration.test.ts`, which drives each writer on a
   * `max: 1` client.
   */
  function countingCtx(tx: unknown) {
    const transactions = { count: 0 };
    const ctx = {
      db: {
        transaction: (cb: (t: unknown) => unknown) => {
          transactions.count += 1;
          return cb(tx);
        },
      },
      tenantId: 'org-1',
    } as never;
    return { ctx, transactions };
  }

  it('updateContact writes a crm_contact audit row inside the mutation transaction', async () => {
    const { updateContact } = await import('./crm-contacts.service');
    const { tx, insertCalls } = buildTx();
    const { ctx, transactions } = countingCtx(tx);

    await updateContact(ctx, 'c1', { displayName: 'Jane' });

    // Assert the shipped write, not a spy on the collaborator: the audit row
    // itself, on the same `tx` object the contact UPDATE ran on.
    const auditCall = insertCalls.find((c) => c.table === docAuditLog);
    expect(auditCall?.rows).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        refType: 'crm_contact',
        refId: 'c1',
        op: 'update',
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'displayName', new: 'Jane' }),
        ]),
      }),
    ]);
    expect(tx.insert).toHaveBeenCalledWith(docAuditLog);
    expect(transactions.count).toBe(1);
  });
});
