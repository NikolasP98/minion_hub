import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));
import { contactFinanceMap, contactCashflow } from './crm-finance.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const dialect = new PgDialect();
/** Last SQL fragment handed to `tx.execute` — the data query, after withOrgCore's setup calls. */
function lastExecutedSql(db: unknown): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  return calls[calls.length - 1][0] as SQL;
}

describe('contactFinanceMap', () => {
  it('returns {} when bothEnabled is false', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    const { db } = createMockDb();
    expect(await contactFinanceMap(ctx(db))).toEqual({});
  });
  it('keys aggregates by contact_id and classifies a repeat procedure buyer', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c1', revenue: 500, invoices: 3, last: '2026-01-01T00:00:00Z', purchased: true, has_deposit: true, proc_dates: 2 }]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c1']).toEqual({ revenue: 500, invoices: 3, lastPurchaseAt: '2026-01-01T00:00:00Z', purchased: true, reservedOnly: false, loyal: true });
  });
  it('flags a deposit-only contact as reservedOnly — POLARITY: has_deposit true + purchased false excludes the contact from revenue-buyer status', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c2', revenue: 50, invoices: 1, last: '2026-02-01T00:00:00Z', purchased: false, has_deposit: true, proc_dates: 0 }]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c2']).toMatchObject({ purchased: false, reservedOnly: true, loyal: false });
  });

  it('PARITY: the compiled query ILIKE-matches the deposit rule keyword as a bound parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c1', revenue: 0, invoices: 0, last: null, purchased: false, has_deposit: false, proc_dates: 0 }]);
    await contactFinanceMap(ctx(db));
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(sql).toContain('bool_or((ii.description ilike $1)) has_deposit');
    expect(sql).toContain(
      "bool_or((ii.description is not null and (ii.description not ilike $2))) has_proc",
    );
    expect(params).toEqual(['%reserva%', '%reserva%']);
  });
});

describe('contactCashflow', () => {
  it('returns null when bothEnabled is false', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    const { db } = createMockDb();
    expect(await contactCashflow(ctx(db), 'c1')).toBeNull();
  });
  it('returns the zero-valued object for a contact with no linked transactions', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ inflow: '0', outflow: '0', net: '0', transactions: 0, last: null }]);
    expect(await contactCashflow(ctx(db), 'c1')).toEqual({
      inflow: '0',
      outflow: '0',
      net: '0',
      transactions: 0,
      lastTransactionAt: null,
    });
  });
  it('sums signed_amount into inflow/outflow/net as money-strings', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { inflow: '500.00', outflow: '120.50', net: '379.50', transactions: 4, last: '2026-07-20' },
    ]);
    expect(await contactCashflow(ctx(db), 'c2')).toEqual({
      inflow: '500.00',
      outflow: '120.50',
      net: '379.50',
      transactions: 4,
      lastTransactionAt: '2026-07-20',
    });
  });
});
