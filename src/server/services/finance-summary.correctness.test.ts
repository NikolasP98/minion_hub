import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureCache, MemoryBackend } from '@minion-stack/cache';

const fixture = vi.hoisted(() => ({
  query: null as null | ((sql: string, params: unknown[]) => Promise<unknown[]>),
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_ctx: unknown, work: (tx: unknown) => unknown) =>
    work({
      execute: (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const query = new PgDialect().sqlToQuery(statement);
        return fixture.query!(query.sql, query.params);
      },
    }),
}));
vi.mock('./modules.service', () => ({ bothEnabled: async () => true }));
vi.mock('./crm-settings.service', () => ({
  resolveDepositRule: async () => ({ keywords: ['reserva'], label: 'Deposit' }),
}));

import {
  clientRevenueRows,
  financeSummary,
  revenueSeries,
  topClients,
  topProducts,
} from './finance.service';
import {
  CONTACT_PARTY,
  contactFinanceSummary,
  contactInvoiceClassSql,
  rankCustomers,
} from './crm-finance.service';
import { sql } from 'drizzle-orm';

const db = new PGlite();
const ctx = { db: {} as never, tenantId: 'finance-summary-fixture' };
const period = { from: null, to: null, bucket: 'month' as const };

beforeAll(async () => {
  fixture.query = async (sql, params) => (await db.query(sql, params)).rows;
  await db.exec(`
    create table fin_invoices (
      id text primary key default gen_random_uuid()::text, client_name text, document_id text,
      org_id text, client_id text, client_doc_number text, issued_at timestamptz,
      shadowed boolean not null default false, status text, currency text,
      total numeric, subtotal numeric, discount numeric, tax numeric
    );
    create table fin_invoice_items (invoice_id text, product_id text, code text, description text, total numeric, quantity numeric);
    create table fin_products (id text primary key, name text);
    create table fin_clients (id text primary key, org_id text, party_id text);
    create table crm_contacts (id text primary key, party_id text, org_id text, display_name text, deleted_at timestamptz, created_at timestamptz default now());
    create table stk_entries (id text primary key, type text);
    create table stk_ledger (entry_id text, org_id text, value_delta numeric, posted_at timestamptz);
    select set_config('app.current_org_id', 'finance-summary-fixture', false);
  `);
});

beforeEach(async () => {
  configureCache({ backend: new MemoryBackend(), namespace: 'finance-summary-correctness' });
  await db.exec(
    'truncate fin_invoices, fin_invoice_items, fin_products, fin_clients, crm_contacts, stk_entries, stk_ledger;',
  );
});
afterAll(async () => {
  await db.close();
});

async function invoice(client: string, status: string, amount: number, issued = '2026-01-10') {
  await db.query(
    `insert into fin_invoices (org_id,client_id,issued_at,status,currency,total,subtotal,discount,tax) values ($1,$2,$3,$4,'PEN',$5,$5,0,0)`,
    [ctx.tenantId, client, issued, status, amount],
  );
}
async function cost(amount: number) {
  await db.exec(`insert into stk_entries values ('issue', 'issue')`);
  await db.query("insert into stk_ledger values ('issue', $1, $2, '2026-01-10')", [
    ctx.tenantId,
    -amount,
  ]);
}

describe('finance summary populations and cache on a real SQL engine', () => {
  it('keeps losses signed instead of reporting break-even', async () => {
    await invoice('live', 'paid', 100);
    await cost(150);
    const result = await financeSummary(ctx, period, 'business');
    expect(result.netRevenue).toBe(-50);
    expect(result.marginRate).toBe(-0.5);
  });

  it.each([false, true])(
    'recomputes summary and series after stock visibility changes from %s',
    async (initial) => {
      await invoice('live', 'paid', 100);
      await cost(40);
      const firstKind = initial ? 'business' : 'personal';
      const nextKind = initial ? 'personal' : 'business';
      const first = await financeSummary(ctx, period, firstKind);
      const firstSeries = await revenueSeries(ctx, period, firstKind);
      const next = await financeSummary(ctx, period, nextKind);
      const nextSeries = await revenueSeries(ctx, period, nextKind);
      expect(first.totalCogs).toBe(initial ? 40 : 0);
      expect(next.totalCogs).toBe(initial ? 0 : 40);
      expect(firstSeries[0].opCost).toBe(initial ? 40 : 0);
      expect(nextSeries[0].opCost).toBe(initial ? 0 : 40);
    },
  );

  it('uses live invoices for sales and clients, and all documents for void rate', async () => {
    await invoice('live', 'paid', 100);
    await invoice('void-only', 'void', 900);
    const result = await financeSummary(ctx, period, 'personal');
    expect(result).toMatchObject({
      invoiceCount: 1,
      uniqueClients: 1,
      newClients: 1,
      avgTicket: 100,
      voidCount: 1,
      voidRate: 0.5,
    });
    const series = await revenueSeries(ctx, period, 'personal');
    expect(series[0]).toMatchObject({ invoices: 1, revenue: 100, gross: 100, voided: 900 });
  });

  it('counts a client as new at their first live invoice, even with an earlier void', async () => {
    await invoice('customer', 'void', 100, '2025-12-10');
    await invoice('customer', 'paid', 100);
    const result = await financeSummary(
      ctx,
      { ...period, from: '2026-01-01', to: '2026-02-01' },
      'personal',
    );
    expect(result.newClients).toBe(1);
  });

  it('excludes void-only customers and products from every economic ranking', async () => {
    await invoice('live', 'paid', 100);
    await invoice('void-only', 'void', 900);
    await invoice('live', 'void', 800);
    await db.exec(`
      insert into fin_clients values ('live','finance-summary-fixture','party-live'), ('void-only','finance-summary-fixture','party-void');
      insert into crm_contacts (id,party_id,org_id,display_name) values ('contact-live','party-live','finance-summary-fixture','Live'), ('contact-void','party-void','finance-summary-fixture','Void');
      insert into fin_invoice_items (invoice_id,code,description,total,quantity)
        select id, case when status='void' then 'VOID' else 'LIVE' end,
          case when status='void' then 'Voided procedure' else 'Live procedure' end,total,1 from fin_invoices;
    `);
    expect((await clientRevenueRows(ctx)).map((r) => [r.docNumber, r.revenue, r.invoices])).toEqual(
      [['live', 100, 1]],
    );
    expect((await topClients(ctx, period)).map((r) => [r.docNumber, r.revenue])).toEqual([
      ['live', 100],
    ]);
    expect((await topProducts(ctx, period)).map((r) => [r.code, r.revenue])).toEqual([
      ['LIVE', 100],
    ]);
    expect((await rankCustomers(ctx)).map((r) => [r.contactId, r.revenue, r.topProduct])).toEqual([
      ['contact-live', 100, 'Live procedure'],
    ]);
    const detail = await contactFinanceSummary(ctx, 'contact-void');
    expect(detail).toMatchObject({
      revenue: 0,
      invoices: 0,
      purchased: false,
      reservedOnly: false,
      loyal: false,
    });
    expect(detail?.recentInvoices).toHaveLength(1); // History retains the void record.
    const classification = new PgDialect().sqlToQuery(
      sql`with ${CONTACT_PARTY}, ${contactInvoiceClassSql({ keywords: ['reserva'], label: 'Deposit' })} select contact_id, total from contact_invoice_class`,
    );
    const rows = await db.query(classification.sql, classification.params);
    expect(rows.rows).toEqual([{ contact_id: 'contact-live', total: 100 }]);
  });

  it('keeps the absolute loss visible with nonpositive billed revenue and a defined zero margin rate', async () => {
    await invoice('refund', 'paid', -100);
    await cost(20);
    const result = await financeSummary(ctx, period, 'business');
    expect(result).toMatchObject({ netRevenue: -120, marginRate: 0 });
  });

  it('reports all-void and empty populations without division by zero', async () => {
    const empty = await financeSummary(ctx, period, 'personal');
    expect(empty).toMatchObject({ invoiceCount: 0, voidRate: 0, marginRate: 0, avgTicket: 0 });
    await invoice('void-only', 'void', 100);
    configureCache({ backend: new MemoryBackend(), namespace: 'finance-summary-all-void' });
    const allVoid = await financeSummary(ctx, period, 'personal');
    expect(allVoid).toMatchObject({
      invoiceCount: 0,
      voidCount: 1,
      voidRate: 1,
      uniqueClients: 0,
      newClients: 0,
    });
  });
});
