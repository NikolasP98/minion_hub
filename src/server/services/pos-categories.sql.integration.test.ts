import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let db: ReturnType<typeof harness.createConnection>;
const fixtureSchema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const orgA = 'qc-category-a';
const orgB = 'qc-category-b';
const legacyOrg = 'qc-category-legacy';

describe('fin_product_categories PostgreSQL invariants', () => {
  beforeAll(async () => {
    // No application URL fallback or conditional skip. Identity is checked before DDL.
    harness = await openDisposablePostgres();
    await harness.owner.unsafe(`CREATE SCHEMA "${fixtureSchema}"`);
    db = harness.createConnection(fixtureSchema);
    // Only prerequisite product columns are synthetic. The full category migration
    // supplies its actual backfill, FK actions, privileges and forced RLS policy.
    await db.unsafe(`CREATE TABLE fin_products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      code text NOT NULL, name text NOT NULL, category text
    );`);
    await db`INSERT INTO fin_products (org_id,code,name,category) VALUES
      (${legacyOrg},'L1','First','Legacy Exact '),
      (${legacyOrg},'L2','Duplicate','Legacy Exact '),
      (${legacyOrg},'L3','Case variant','legacy exact'),
      (${legacyOrg},'L4','Uncategorized',NULL)`;
    const migration = readFileSync(
      new URL(
        '../../../supabase/migrations/20260922120000_fin_product_categories.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.unsafe(migration.replaceAll('public.', `"${fixtureSchema}".`));
    await db.unsafe(`GRANT USAGE ON SCHEMA "${fixtureSchema}" TO app_ledger`);
  });

  beforeEach(async () => {
    // Tests are independent; preserve only the migration's legacy backfill evidence.
    await db`DELETE FROM fin_products WHERE org_id IN (${orgA},${orgB})`;
    await db`DELETE FROM fin_product_categories WHERE org_id IN (${orgA},${orgB})`;
    await db`INSERT INTO fin_product_categories (org_id,name,color)
      VALUES (${orgA},'Legacy Exact ','#3b82f6')`;
    await db`INSERT INTO fin_products (org_id,code,name,category)
      VALUES (${orgA},'QCA','QA category product','Legacy Exact ')`;
  });

  afterAll(async () => {
    if (!harness) return;
    try {
      await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      expect(
        await harness.owner`SELECT nspname FROM pg_namespace WHERE nspname=${fixtureSchema}`,
      ).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it('backfills distinct exact legacy values without changing product assignments', async () => {
    expect(
      await db`SELECT name FROM fin_product_categories WHERE org_id=${legacyOrg} ORDER BY name COLLATE "C"`,
    ).toEqual([{ name: 'Legacy Exact ' }, { name: 'legacy exact' }]);
    expect(
      await db`SELECT code,category FROM fin_products WHERE org_id=${legacyOrg} ORDER BY code`,
    ).toEqual([
      { code: 'L1', category: 'Legacy Exact ' },
      { code: 'L2', category: 'Legacy Exact ' },
      { code: 'L3', category: 'legacy exact' },
      { code: 'L4', category: null },
    ]);
  });

  it('cascades exact-name rename and clears assignments on delete', async () => {
    await db`UPDATE fin_product_categories SET name='Renamed Exact' WHERE org_id=${orgA}`;
    expect(await db`SELECT org_id,category FROM fin_products WHERE org_id=${orgA}`).toEqual([
      { org_id: orgA, category: 'Renamed Exact' },
    ]);
    await db`DELETE FROM fin_product_categories WHERE org_id=${orgA} AND name='Renamed Exact'`;
    // SET NULL targets category only: the product's tenant ownership must survive.
    expect(await db`SELECT org_id,category FROM fin_products WHERE org_id=${orgA}`).toEqual([
      { org_id: orgA, category: null },
    ]);
  });

  it('rejects cross-org and stale category assignments', async () => {
    await db`INSERT INTO fin_product_categories (org_id,name,color) VALUES (${orgA},'Only A','#10b981')`;
    await expect(db`INSERT INTO fin_products (org_id,code,name,category)
      VALUES (${orgB},'QCB','Cross org','Only A')`).rejects.toMatchObject({ code: '23503' });
    await db`DELETE FROM fin_product_categories WHERE org_id=${orgA} AND name='Only A'`;
    await expect(
      db`UPDATE fin_products SET category='Only A' WHERE org_id=${orgA} AND code='QCA'`,
    ).rejects.toMatchObject({ code: '23503' });
    expect(await db`SELECT category FROM fin_products WHERE org_id=${orgA}`).toEqual([
      { category: 'Legacy Exact ' },
    ]);
    expect(await db`SELECT id FROM fin_products WHERE org_id=${orgB}`).toEqual([]);
  });

  it('forces RLS so an app role sees and changes only its organization', async () => {
    await db`INSERT INTO fin_product_categories (org_id,name,color)
      VALUES (${orgA},'Visible A','#f59e0b'),(${orgB},'Hidden B','#ef4444')`;
    const [role] = await db`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='app_ledger'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const [table] = await db`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid=${`${fixtureSchema}.fin_product_categories`}::regclass`;
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const rows = await db.begin(async (tx) => {
      await tx`SET LOCAL ROLE app_ledger`;
      await tx`SELECT set_config('app.current_org_id',${orgA},true)`;
      expect(
        await tx`UPDATE fin_product_categories SET name='Tampered' WHERE org_id=${orgB} RETURNING id`,
      ).toEqual([]);
      expect(
        await tx`DELETE FROM fin_product_categories WHERE org_id=${orgB} RETURNING id`,
      ).toEqual([]);
      await tx`INSERT INTO fin_product_categories (org_id,name,color) VALUES (${orgA},'Added A','#06b6d4')`;
      return tx`SELECT org_id,name FROM fin_product_categories ORDER BY name`;
    });
    expect(rows).toEqual([
      { org_id: orgA, name: 'Added A' },
      { org_id: orgA, name: 'Legacy Exact ' },
      { org_id: orgA, name: 'Visible A' },
    ]);
    await expect(
      db.begin(async (tx) => {
        await tx`SET LOCAL ROLE app_ledger`;
        await tx`SELECT set_config('app.current_org_id',${orgA},true)`;
        await tx`INSERT INTO fin_product_categories (org_id,name,color) VALUES (${orgB},'Foreign insert','#06b6d4')`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await db`SELECT name FROM fin_product_categories WHERE org_id=${orgB}`).toEqual([
      { name: 'Hidden B' },
    ]);
  });
});
