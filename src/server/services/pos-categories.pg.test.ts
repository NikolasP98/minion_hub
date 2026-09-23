import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.HUB_TEST_DB_URL;
const run = url ? describe : describe.skip;
const db = url ? postgres(url, { max: 1 }) : null;
const orgA = `qc-category-a-${randomUUID()}`;
const orgB = `qc-category-b-${randomUUID()}`;

run('fin_product_categories PostgreSQL invariants', () => {
  beforeAll(async () => {
    await db!`insert into fin_product_categories (org_id, name, color)
      values (${orgA}, 'Legacy Exact ', '#3b82f6')`;
    await db!`insert into fin_products (org_id, code, name, category)
      values (${orgA}, 'QCA', 'QA category product', 'Legacy Exact ')`;
  });

  afterAll(async () => {
    await db!`delete from fin_products where org_id in (${orgA}, ${orgB})`;
    await db!`delete from fin_product_categories where org_id in (${orgA}, ${orgB})`;
    await db?.end();
  });

  it('cascades exact-name rename and clears assignments on delete', async () => {
    await db!`update fin_product_categories set name = 'Renamed Exact' where org_id = ${orgA}`;
    const [renamed] = await db!`select category from fin_products where org_id = ${orgA}`;
    expect(renamed.category).toBe('Renamed Exact');

    await db!`delete from fin_product_categories where org_id = ${orgA} and name = 'Renamed Exact'`;
    const [deleted] = await db!`select category from fin_products where org_id = ${orgA}`;
    expect(deleted.category).toBeNull();
  });

  it('rejects cross-org and stale category assignments', async () => {
    await db!`insert into fin_product_categories (org_id, name, color)
      values (${orgA}, 'Only A', '#10b981')`;
    await expect(
      db!`insert into fin_products (org_id, code, name, category)
        values (${orgB}, 'QCB', 'Cross org', 'Only A')`,
    ).rejects.toMatchObject({ code: '23503' });

    await db!`delete from fin_product_categories where org_id = ${orgA} and name = 'Only A'`;
    await expect(
      db!`update fin_products set category = 'Only A' where org_id = ${orgA} and code = 'QCA'`,
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('forces RLS so an app role sees only its organization', async () => {
    await db!`insert into fin_product_categories (org_id, name, color)
      values (${orgA}, 'Visible A', '#f59e0b'), (${orgB}, 'Hidden B', '#ef4444')`;
    const rows = await db!.begin(async (tx) => {
      await tx`set local role app_ledger`;
      await tx`select set_config('app.current_org_id', ${orgA}, true)`;
      return tx`select org_id, name from fin_product_categories order by name`;
    });
    expect(rows).toEqual([{ org_id: orgA, name: 'Visible A' }]);
  });
});
