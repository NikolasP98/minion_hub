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
function buildTx() {
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
  const update = vi.fn(() => ({
    set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 'c1', displayName: 'Jane' }]) }) }),
  }));
  return { tx: { insert, delete: del, execute, update }, insertCalls };
}

function ctxWithTx(tx: unknown) {
  return { db: { transaction: (cb: (t: unknown) => unknown) => cb(tx) }, tenantId: 'org-1' } as never;
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
});

describe('crm contacts audit (§B.2)', () => {
  it('updateContact writes a crm_contact audit row', async () => {
    vi.doMock('./activity.service', async () => {
      const actual = await vi.importActual<typeof import('./activity.service')>('./activity.service');
      return { ...actual, recordAudit: vi.fn(actual.recordAudit) };
    });
    const { updateContact } = await import('./crm-contacts.service');
    const activity = await import('./activity.service');
    const { tx } = buildTx();
    await updateContact(ctxWithTx(tx), 'c1', { displayName: 'Jane' });

    expect(activity.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refType: 'crm_contact', op: 'update' }),
    );
    vi.doUnmock('./activity.service');
  });
});
