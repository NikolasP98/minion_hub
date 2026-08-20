import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { normalizeSql } from '$server/test-utils/normalize-sql';
const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));
import {
  contactFinanceMap,
  contactCashflow,
  contactFinanceSummary,
  rankCustomers,
} from './crm-finance.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

const dialect = new PgDialect();
/** Last SQL fragment handed to `tx.execute` — the data query, after withOrgCore's setup calls. */
function lastExecutedSql(db: unknown): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  return calls[calls.length - 1][0] as SQL;
}
/** The single `tx.execute` call (among withOrgCore's setup calls) whose compiled
 *  SQL contains `marker` — used when a function issues more than one data query. */
function executedSqlContaining(db: unknown, marker: string): SQL {
  const calls = (db as { execute: { mock: { calls: unknown[][] } } }).execute.mock.calls;
  const hit = calls.find((c) => dialect.sqlToQuery(c[0] as SQL).sql.includes(marker));
  if (!hit) throw new Error(`no executed query contains: ${marker}`);
  return hit[0] as SQL;
}

describe('contactFinanceMap', () => {
  it('returns {} when bothEnabled is false', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    const { db } = createMockDb();
    expect(await contactFinanceMap(ctx(db))).toEqual({});
  });
  it('MAPPING: keys aggregates by contact_id and coerces the SQL classification flags — JS-side row→field logic only, has_deposit/has_proc are pre-classified inputs here, not derived by this test. Real deposit/procedure classification of invoice-item text is verified against PostgreSQL in crm-deposit-rule.sql.integration.test.ts.', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        contact_id: 'c1',
        revenue: 500,
        invoices: 3,
        last: '2026-01-01T00:00:00Z',
        purchased: true,
        reserved_only: false,
        loyal: true,
      },
    ]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c1']).toEqual({
      revenue: 500,
      invoices: 3,
      lastPurchaseAt: '2026-01-01T00:00:00Z',
      purchased: true,
      reservedOnly: false,
      loyal: true,
    });
  });
  it('MAPPING: reserved_only true ⇒ reservedOnly true (same caveat as above — the aggregate row is injected, not classified by this test)', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        contact_id: 'c2',
        revenue: 50,
        invoices: 1,
        last: '2026-02-01T00:00:00Z',
        purchased: false,
        reserved_only: true,
        loyal: false,
      },
    ]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c2']).toMatchObject({ purchased: false, reservedOnly: true, loyal: false });
  });

  it('PARITY: the full compiled query matches the shipped shape, with the deposit rule bound as a parameter', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        contact_id: 'c1',
        revenue: 0,
        invoices: 0,
        last: null,
        purchased: false,
        reserved_only: false,
        loyal: false,
      },
    ]);
    await contactFinanceMap(ctx(db));
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `with contact_party as (
          select distinct on (c.party_id) c.party_id, c.id as contact_id
          from crm_contacts c
          where c.org_id = current_setting('app.current_org_id', true)
            and c.party_id is not null and c.deleted_at is null
          order by c.party_id, c.created_at asc
        ),
        contact_invoice_class as (
          select cp.contact_id, fi.id invoice_id, coalesce(fi.total,0)::float8 total, fi.issued_at,
                 bool_or(coalesce((ii.description ilike $1), false)) has_deposit, bool_or((ii.description is not null and coalesce((ii.description not ilike $2), true))) has_proc
          from contact_party cp
          join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
          join fin_invoices fi on fi.client_id = fc.id
          left join fin_invoice_items ii on ii.invoice_id = fi.id
          group by cp.contact_id, fi.id, fi.total, fi.issued_at
        )
        select contact_id,
               coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
               coalesce(bool_or(has_proc), false) purchased, (not coalesce(bool_or(has_proc), false) and coalesce(bool_or(has_deposit), false)) reserved_only, (count(distinct case when has_proc then issued_at::date end) >= 2) loyal
        from contact_invoice_class group by contact_id`,
      ),
    );
    expect(params).toEqual(['%reserva%', '%reserva%']);
  });
});

describe('contactFinanceSummary', () => {
  it('PARITY: both compiled queries (representative item + aggregate) match the shipped shape', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'inv1', document_id: 'd1', issued_at: null, total: 0, status: 's', item: null },
    ]);
    await contactFinanceSummary(ctx(db), 'c1');

    const itemQuery = dialect.sqlToQuery(executedSqlContaining(db, 'as item'));
    expect(normalizeSql(itemQuery.sql)).toBe(
      normalizeSql(
        `with cparty as (
          select party_id from crm_contacts
          where id = $1 and org_id = current_setting('app.current_org_id', true) and party_id is not null
        )
        select fi.id, fi.document_id, fi.issued_at, coalesce(fi.total,0)::float8 total, fi.status,
               -- the "what was done": a representative line, procedures first (deposit lines last), priciest first.
               (select ii.description from fin_invoice_items ii where ii.invoice_id = fi.id and ii.description is not null
                  order by coalesce((ii.description ilike $2), false) asc, ii.total desc nulls last limit 1) as item
        from fin_invoices fi
        join fin_clients fc on fc.id = fi.client_id
        where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
        order by fi.issued_at desc nulls last limit 10`,
      ),
    );
    expect(itemQuery.params).toEqual(['c1', '%reserva%']);

    const aggQuery = dialect.sqlToQuery(executedSqlContaining(db, 'proc_dates'));
    expect(normalizeSql(aggQuery.sql)).toBe(
      normalizeSql(
        `with cparty as (select party_id from crm_contacts
          where id = $1 and org_id = current_setting('app.current_org_id', true) and party_id is not null),
        inv as (
          select fi.id, coalesce(fi.total,0)::float8 total, fi.issued_at,
                 bool_or(coalesce((ii.description ilike $2), false)) has_deposit, bool_or((ii.description is not null and coalesce((ii.description not ilike $3), true))) has_proc
          from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
          left join fin_invoice_items ii on ii.invoice_id = fi.id
          where fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = (select party_id from cparty)
          group by fi.id, fi.total, fi.issued_at
        )
        select coalesce(sum(total),0)::float8 revenue, count(*)::int invoices, max(issued_at) last,
               bool_or(has_proc) purchased, bool_or(has_deposit) has_deposit,
               count(distinct case when has_proc then issued_at::date end)::int proc_dates
        from inv`,
      ),
    );
    expect(aggQuery.params).toEqual(['c1', '%reserva%', '%reserva%']);
  });
});

describe('rankCustomers', () => {
  it('PARITY: revenue-ranked compiled query matches the shipped shape', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await rankCustomers(ctx(db), 'revenue', 5);
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `with contact_party as (
          select distinct on (c.party_id) c.party_id, c.id as contact_id
          from crm_contacts c
          where c.org_id = current_setting('app.current_org_id', true)
            and c.party_id is not null and c.deleted_at is null
          order by c.party_id, c.created_at asc
        ),
        pinv as (
          select cp.contact_id, cp.party_id, coalesce(fi.total,0)::float8 total, fi.issued_at
          from contact_party cp
          join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
          join fin_invoices fi on fi.client_id = fc.id
        ),
        agg as (
          select contact_id, party_id, sum(total)::float8 revenue, count(*)::int invoices,
                 min(issued_at) first_at, max(issued_at) last_at
          from pinv group by contact_id, party_id
          order by revenue desc nulls last
          limit 5
        )
        select a.contact_id, c.display_name as name, a.revenue, a.invoices, a.first_at, a.last_at,
               (select ii.description
                  from fin_invoice_items ii
                  join fin_invoices fi on fi.id = ii.invoice_id
                  join fin_clients fc on fc.id = fi.client_id and fc.party_id = a.party_id
                  where fc.org_id = current_setting('app.current_org_id', true)
                    and ii.description is not null and coalesce((ii.description not ilike $1), true)
                  group by ii.description order by sum(coalesce(ii.total,0)) desc nulls last limit 1) as top_product
        from agg a
        left join crm_contacts c on c.id = a.contact_id
        order by a.revenue desc nulls last`,
      ),
    );
    expect(params).toEqual(['%reserva%']);
  });

  it('PARITY: recency-ranked compiled query orders by last_at instead of revenue (same top_product predicate)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await rankCustomers(ctx(db), 'recency', 7);
    const { sql, params } = dialect.sqlToQuery(lastExecutedSql(db));
    expect(normalizeSql(sql)).toBe(
      normalizeSql(
        `with contact_party as (
          select distinct on (c.party_id) c.party_id, c.id as contact_id
          from crm_contacts c
          where c.org_id = current_setting('app.current_org_id', true)
            and c.party_id is not null and c.deleted_at is null
          order by c.party_id, c.created_at asc
        ),
        pinv as (
          select cp.contact_id, cp.party_id, coalesce(fi.total,0)::float8 total, fi.issued_at
          from contact_party cp
          join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and fc.party_id = cp.party_id
          join fin_invoices fi on fi.client_id = fc.id
        ),
        agg as (
          select contact_id, party_id, sum(total)::float8 revenue, count(*)::int invoices,
                 min(issued_at) first_at, max(issued_at) last_at
          from pinv group by contact_id, party_id
          order by last_at desc nulls last
          limit 7
        )
        select a.contact_id, c.display_name as name, a.revenue, a.invoices, a.first_at, a.last_at,
               (select ii.description
                  from fin_invoice_items ii
                  join fin_invoices fi on fi.id = ii.invoice_id
                  join fin_clients fc on fc.id = fi.client_id and fc.party_id = a.party_id
                  where fc.org_id = current_setting('app.current_org_id', true)
                    and ii.description is not null and coalesce((ii.description not ilike $1), true)
                  group by ii.description order by sum(coalesce(ii.total,0)) desc nulls last limit 1) as top_product
        from agg a
        left join crm_contacts c on c.id = a.contact_id
        order by a.last_at desc nulls last`,
      ),
    );
    expect(params).toEqual(['%reserva%']);
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
