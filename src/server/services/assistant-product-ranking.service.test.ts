import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${ctx.tenantId}, true)`);
      // PGlite returns { rows }; production postgres-js returns the row array.
      // Adapt transport shape only; execute the actual service SQL unchanged.
      return fn(
        new Proxy(tx, {
          get(target, key, receiver) {
            if (key === 'execute')
              return async (query: Parameters<typeof tx.execute>[0]) =>
                ((await target.execute(query)) as unknown as { rows: unknown[] }).rows;
            const value = Reflect.get(target, key, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
      );
    }),
}));
import { assistantProductRanking } from './assistant-product-ranking.service';

const pg = new PGlite();
const ctx = { db: drizzle(pg) as unknown as CoreCtx['db'], tenantId: 'fixture-org' };
const period = { bucket: 'month' as const, from: null, to: null };
beforeAll(async () => {
  await pg.exec(`create table fin_invoices(id text primary key, org_id text, issued_at timestamptz,
    currency text, status text, shadowed boolean default false);
    create table fin_products(id text primary key, org_id text, name text);
    create table fin_invoice_items(id text, invoice_id text, product_id text, code text,
      description text, quantity numeric, total numeric);`);
});
beforeEach(async () => {
  await pg.exec('truncate fin_invoice_items, fin_invoices, fin_products');
});
afterAll(async () => pg.close());
async function line(id: string, qty: number, amount: number, currency = 'PEN', overrides = {}) {
  const inv = {
    org: ctx.tenantId,
    status: 'paid',
    shadowed: false,
    date: '2030-01-10T12:00:00Z',
    ...overrides,
  };
  await pg.query('insert into fin_invoices values($1,$2,$3,$4,$5,$6)', [
    id,
    inv.org,
    inv.date,
    currency,
    inv.status,
    inv.shadowed,
  ]);
  await pg.query('insert into fin_invoice_items values($1,$1,$1,$1,$1,$2,$3)', [id, qty, amount]);
}

describe('assistant product rankings execute the requested metric before the cap', () => {
  it('finds a low-price quantity winner outside the revenue top15', async () => {
    for (let i = 0; i < 16; i++) await line('expensive-' + i, 1, 1000 + i);
    await line('quantity-winner', 100, 10);
    const result = await assistantProductRanking(ctx, period, { metric: 'quantity', limit: 1 });
    expect(result.status).toBe('available');
    expect(result.groups[0]).toMatchObject({
      currency: null,
      total: 17,
      returned: 1,
      truncated: true,
    });
    expect(result.groups[0].rows[0]).toMatchObject({
      productId: 'quantity-winner',
      value: 100,
      rank: 1,
    });
    expect(result).toMatchObject({
      metric: 'quantity',
      unit: 'invoice_item_quantity',
      source: 'nonvoid_unshadowed_invoice_items',
    });
  });
  it('keeps monetary currencies in separate rankings', async () => {
    await line('pen', 1, 100, 'PEN');
    await line('usd', 1, 200, 'USD');
    const result = await assistantProductRanking(ctx, period, { metric: 'revenue', limit: 2 });
    expect(result.groups.map((g) => [g.currency, g.rows[0].value])).toEqual([
      ['PEN', 100],
      ['USD', 200],
    ]);
    expect(result).toMatchObject({ monetaryCurrenciesCombined: false });
  });
  it('discloses a tie crossing the hard row limit', async () => {
    await line('a', 10, 30);
    await line('b', 10, 20);
    await line('c', 10, 10);
    const result = await assistantProductRanking(ctx, period, { metric: 'quantity', limit: 2 });
    expect(result.groups[0]).toMatchObject({
      total: 3,
      returned: 2,
      truncated: true,
      tieTruncated: true,
    });
    expect(result.groups[0].rows.map((r) => r.rank)).toEqual([1, 1]);
  });
  it('excludes void, shadowed, foreign-org and out-of-period rows', async () => {
    await line('included', 1, 5);
    await line('void', 999, 999, 'PEN', { status: 'void' });
    await line('shadowed', 999, 999, 'PEN', { shadowed: true });
    await line('foreign', 999, 999, 'PEN', { org: 'other-org' });
    await line('outside', 999, 999, 'PEN', { date: '2029-01-01T00:00:00Z' });
    const result = await assistantProductRanking(
      ctx,
      { ...period, from: '2030-01-01T00:00:00Z', to: '2031-01-01T00:00:00Z' },
      { metric: 'quantity', limit: 10 },
    );
    expect(result.groups[0].rows.map((r) => r.productId)).toEqual(['included']);
  });
  it('returns unavailable margin instead of substituting price or revenue', async () => {
    await line('expensive', 1, 999);
    expect(
      await assistantProductRanking(ctx, period, { metric: 'margin', limit: 10 }),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'product_cost_attribution_unavailable',
      groups: [],
    });
    expect(
      await assistantProductRanking(ctx, period, { metric: 'margin', limit: 10, allowCost: false }),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'sensitive_cost_access_denied',
      groups: [],
    });
  });
  it('returns an explicit empty scoped population', async () => {
    expect(
      await assistantProductRanking(ctx, period, { metric: 'quantity', limit: 10 }),
    ).toMatchObject({
      status: 'available',
      groups: [],
      totalCurrencies: 0,
    });
  });
  it('does not merge unidentified descriptions into an artificial quantity winner', async () => {
    await line('identified', 10, 10);
    await line('missing-a', 100, 1);
    await line('missing-b', 100, 1);
    await pg.exec(
      "update fin_invoice_items set product_id=null, code='   ' where invoice_id like 'missing-%'",
    );
    const result = await assistantProductRanking(ctx, period, { metric: 'quantity', limit: 1 });
    expect(result).toMatchObject({
      unidentifiedLineCount: 2,
      wholeBusinessCoverage: 'not_established',
    });
    expect(result.groups[0].rows.map((r) => r.productId)).toEqual(['identified']);
    await pg.exec("delete from fin_invoice_items where invoice_id='identified'");
    expect(
      await assistantProductRanking(ctx, period, { metric: 'quantity', limit: 1 }),
    ).toMatchObject({
      groups: [],
      unidentifiedLineCount: 2,
    });
  });
});
