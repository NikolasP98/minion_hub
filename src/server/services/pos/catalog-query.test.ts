import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';

const mocks = vi.hoisted(() => ({ scope: vi.fn(), currency: vi.fn() }));
vi.mock('$server/db/with-org-core', () => ({ withOrgCore: mocks.scope }));
vi.mock('./settings', () => ({ getPosCurrencyInTx: mocks.currency }));
import { queryCatalogPrices } from './catalog-query';

const db = new PGlite();
const dialect = new PgDialect();
const ctx = { tenantId: 'org-a', profileId: 'profile-a' } as CoreCtx;

describe('bounded catalog price SQL', () => {
  beforeAll(async () => {
    await db.exec(`
      create table fin_products (id text, org_id text, code text, name text, kind text, active boolean, unit_price numeric);
      create table fin_product_components (bundle_product_id text, org_id text);
      create table pos_settings (org_id text, currency text);
      insert into pos_settings values ('org-a', 'USD'), ('org-b', 'PEN');
    `);
    mocks.scope.mockImplementation(async (scope, work) => {
      expect(scope).toMatchObject({ tenantId: expect.any(String) });
      return work({
        execute: async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
          const query = dialect.sqlToQuery(statement);
          return (await db.query(query.sql, query.params)).rows;
        },
      });
    });
    mocks.currency.mockImplementation(async (_tx, orgId: string) => {
      const { rows } = await db.query<{ currency: string }>(
        'select currency from pos_settings where org_id=$1',
        [orgId],
      );
      return rows[0]?.currency ?? 'PEN';
    });
  });
  beforeEach(async () => {
    await db.exec(`truncate fin_products, fin_product_components;
      insert into fin_products values
      ('a','org-a','A','Product A','product',true,10.123),
      ('b','org-a','B','Product B','product',true,25),
      ('c','org-a','C','Product C','product',true,25),
      ('n','org-a','N','Missing','product',true,null),
      ('i','org-a','I','Inactive','product',false,999),
      ('s','org-a','S','Service','service',true,100),
      ('p','org-a','P','Package','service',true,200),
      ('x','org-b','X','Other org','product',true,9999);
      insert into fin_product_components values ('p','org-a'), ('a','org-b');`);
  });
  afterAll(async () => {
    await db.close();
  });

  it('ranks only active products in the requested org, counts nulls and ties outside the limit', async () => {
    const result = await queryCatalogPrices(ctx, 'product', 1);
    expect(result).toMatchObject({
      currency: 'USD',
      currencySource: 'pos_settings',
      matchedCount: 4,
      missingPriceCount: 1,
      maxPrice: 25,
      tiedAtMaximum: 2,
      truncated: true,
    });
    expect(result.items.map((item) => item.productId)).toEqual(['b']);
    expect(result.items[0].source.path).toBe('/pos/catalog');
    expect(Date.parse(result.asOf)).not.toBeNaN();
  });
  it('uses stored unrounded prices and deterministic tie ordering', async () => {
    const result = await queryCatalogPrices(ctx, 'product', 20);
    expect(result.items.map((item) => [item.productId, item.unitPrice])).toEqual([
      ['b', 25],
      ['c', 25],
      ['a', 10.123],
    ]);
    expect(result.truncated).toBe(false);
  });
  it('returns all three maximum winners in one bounded maximum-mode read', async () => {
    await db.exec(
      "insert into fin_products values ('d','org-a','D','Product D','product',true,25)",
    );
    const result = await queryCatalogPrices(ctx, 'product', 1, 'maximum');
    expect(result.items.map((item) => item.productId)).toEqual(['b', 'c', 'd']);
    expect(result).toMatchObject({
      mode: 'maximum',
      appliedLimit: 20,
      maxPrice: 25,
      tiedAtMaximum: 3,
      matchedCount: 5,
      missingPriceCount: 1,
      truncated: false,
    });
    expect((await queryCatalogPrices(ctx, 'product', 1, 'ranked')).items).toHaveLength(1);
  });
  it('keeps maximum winners capped while retaining the full overflow count', async () => {
    await db.exec(
      "insert into fin_products select 't'||n,'org-a','T'||n,'Tie '||n,'product',true,500 from generate_series(1,1000) n",
    );
    const result = await queryCatalogPrices(ctx, 'product', 1, 'maximum');
    expect(result.items).toHaveLength(20);
    expect(result.items.every((item) => item.unitPrice === 500)).toBe(true);
    expect(result).toMatchObject({
      mode: 'maximum',
      appliedLimit: 20,
      tiedAtMaximum: 1000,
      truncated: true,
    });
  });
  it('handles a unique zero-priced maximum and empty maximum sets without inventing a price', async () => {
    await db.exec(
      "delete from fin_products where org_id='org-a' and id <> 'n'; insert into fin_products values ('z','org-a','Z','Zero','product',true,0)",
    );
    expect(await queryCatalogPrices(ctx, 'product', 1, 'maximum')).toMatchObject({
      items: [{ productId: 'z', unitPrice: 0 }],
      maxPrice: 0,
      tiedAtMaximum: 1,
      truncated: false,
    });
    await db.exec("delete from fin_products where id='z'");
    expect(await queryCatalogPrices(ctx, 'product', 1, 'maximum')).toMatchObject({
      items: [],
      maxPrice: null,
      tiedAtMaximum: 0,
      missingPriceCount: 1,
      truncated: false,
    });
  });
  it('separates services and derived bundles, and allows an explicit all query', async () => {
    expect(
      (await queryCatalogPrices(ctx, 'service', 20)).items.map((item) => item.productId),
    ).toEqual(['s']);
    expect(
      (await queryCatalogPrices(ctx, 'bundle', 20)).items.map((item) => item.productId),
    ).toEqual(['p']);
    expect((await queryCatalogPrices(ctx, 'all', 20)).items.map((item) => item.productId)).toEqual([
      'p',
      's',
      'b',
      'c',
      'a',
    ]);
  });
  it('keeps another organization and its currency isolated', async () => {
    const result = await queryCatalogPrices({ ...ctx, tenantId: 'org-b' }, 'product', 20);
    expect(result.currency).toBe('PEN');
    expect(result.items.map((item) => item.productId)).toEqual(['x']);
  });
  it('keeps maximum mode scoped to the requested tenant and sellable kind', async () => {
    expect(
      (await queryCatalogPrices(ctx, 'service', 1, 'maximum')).items.map((item) => item.productId),
    ).toEqual(['s']);
    expect(
      (await queryCatalogPrices(ctx, 'bundle', 1, 'maximum')).items.map((item) => item.productId),
    ).toEqual(['p']);
    expect(
      (await queryCatalogPrices(ctx, 'all', 1, 'maximum')).items.map((item) => item.productId),
    ).toEqual(['p']);
    const other = await queryCatalogPrices({ ...ctx, tenantId: 'org-b' }, 'product', 1, 'maximum');
    expect(other.currency).toBe('PEN');
    expect(other.items.map((item) => item.productId)).toEqual(['x']);
  });
  it('returns a truthful empty summary and never interprets a missing price as zero', async () => {
    await db.exec("delete from fin_products where org_id='org-a' and id <> 'n'");
    expect(await queryCatalogPrices(ctx, 'product', 5)).toMatchObject({
      items: [],
      matchedCount: 1,
      missingPriceCount: 1,
      maxPrice: null,
      tiedAtMaximum: 0,
      truncated: false,
    });
    await db.exec("delete from fin_products where org_id='org-a'");
    expect(await queryCatalogPrices(ctx, 'product', 5)).toMatchObject({
      items: [],
      matchedCount: 0,
      missingPriceCount: 0,
      maxPrice: null,
      tiedAtMaximum: 0,
    });
  });
  it('bounds a large tied catalog while reporting the full tie count', async () => {
    await db.exec(
      "insert into fin_products select 't'||n,'org-a','T'||n,'Tie '||n,'product',true,500 from generate_series(1,1000) n",
    );
    const result = await queryCatalogPrices(ctx, 'product', 20);
    expect(result.items).toHaveLength(20);
    expect(result.tiedAtMaximum).toBe(1000);
    expect(result.truncated).toBe(true);
  });
});
