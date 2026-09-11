import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { SQL, is } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { stkEntries } from '$server/db/pg-schema/stock';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';

const boundaries = vi.hoisted(() => ({ audit: vi.fn(), afterTransaction: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({
  getOrgTransactionDb: (db: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  }) => ({
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const result = await db.transaction(callback);
      await boundaries.afterTransaction();
      return result;
    },
  }),
}));
vi.mock('./activity.service', () => ({ recordAudit: boundaries.audit }));
vi.mock('./notif.service', () => ({ registerNotifCandidateSource: vi.fn() }));
// Sequence formatting is unrelated; actual ledger, bins, entry transactions and
// PostgreSQL row locks/constraints execute. Multi-connection races remain 10-03.
vi.mock('./naming-series', () => ({ nextSerialId: async () => 'STE-FIXTURE' }));
import {
  findEntryByInvoice,
  cancelEntry,
  createIssueFromInvoice,
  submitEntry,
  updateEntry,
  deleteEntry,
} from './stock.service';
import {
  invoiceCollisionSql,
  invoiceInvalidIdentitySql,
  validatePreflightArgs,
} from '../../../scripts/stock-invoice-dedupe-preflight';

const client = new PGlite();
const queries: string[] = [];
const db = drizzle(client, {
  logger: {
    logQuery: (query) => {
      queries.push(query);
    },
  },
});
const ORG = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const INVOICE = '20000000-0000-4000-8000-abcdef000001';
const ITEM = '30000000-0000-4000-8000-000000000001';
const WH = '40000000-0000-4000-8000-000000000001';
const ctx: CoreCtx = { tenantId: ORG, db: db as unknown as CoreCtx['db'] };
const actor = { id: null, name: null };
const input = {
  invoiceId: INVOICE,
  warehouseId: WH,
  lines: [{ itemId: ITEM, qty: 2 }],
  submit: true,
  actor,
};
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260909090200_stock_invoice_issue_identity.sql',
    import.meta.url,
  ),
  'utf8',
);

async function counts() {
  return (
    await client.query<{ entries: number; ledger: number; qty: string }>(`SELECT
    (SELECT count(*)::integer FROM stk_entries) AS entries,
    (SELECT count(*)::integer FROM stk_ledger) AS ledger,
    (SELECT qty::text FROM stk_bins WHERE org_id='${ORG}') AS qty`)
  ).rows[0];
}
async function addEntry(org: string, status: string, metadata: unknown) {
  return client.query(
    "INSERT INTO stk_entries (org_id,type,status,metadata) VALUES ($1,'issue',$2,$3) RETURNING id",
    [org, status, JSON.stringify(metadata)],
  );
}

beforeAll(async () => {
  await client.exec(`CREATE ROLE app_ledger;
    CREATE TABLE fin_invoices (id uuid PRIMARY KEY, org_id text NOT NULL, provider_ref text);
    CREATE TABLE stk_items (id uuid PRIMARY KEY, org_id text NOT NULL, units_per_stock_uom numeric);
    CREATE TABLE stk_warehouses (id uuid PRIMARY KEY, org_id text NOT NULL);
    CREATE TABLE stk_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      human_id text, type text NOT NULL, status text NOT NULL DEFAULT 'draft', party_id uuid,
      note text, posted_at timestamptz, created_by text, metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE stk_entry_lines (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      entry_id uuid NOT NULL REFERENCES stk_entries, item_id uuid NOT NULL, qty numeric NOT NULL, uom text,
      rate numeric, from_warehouse_id uuid, to_warehouse_id uuid, line_no integer NOT NULL DEFAULT 0);
    CREATE TABLE stk_ledger (id bigserial PRIMARY KEY, org_id text NOT NULL, item_id uuid NOT NULL,
      warehouse_id uuid NOT NULL, entry_id uuid NOT NULL, qty_delta numeric NOT NULL, qty_after numeric NOT NULL,
      valuation_rate numeric NOT NULL, value_delta numeric NOT NULL, posted_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE stk_bins (org_id text NOT NULL, item_id uuid NOT NULL, warehouse_id uuid NOT NULL,
      qty numeric NOT NULL, valuation_rate numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (org_id,item_id,warehouse_id));
    GRANT USAGE ON SCHEMA public TO app_ledger;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_ledger;
    REVOKE UPDATE, DELETE ON stk_ledger FROM app_ledger;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_ledger;`);
  for (const table of [
    'fin_invoices',
    'stk_items',
    'stk_warehouses',
    'stk_entries',
    'stk_entry_lines',
    'stk_ledger',
    'stk_bins',
  ]) {
    await client.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_org ON ${table} TO app_ledger USING (org_id = current_setting('app.current_org_id',true))
      WITH CHECK (org_id = current_setting('app.current_org_id',true));`);
  }
  await client.exec(migration);
}, 30_000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  queries.length = 0;
  boundaries.audit.mockReset();
  boundaries.afterTransaction.mockReset();
  await client.exec(
    'TRUNCATE stk_ledger, stk_bins, stk_entry_lines, stk_entries, fin_invoices, stk_items, stk_warehouses CASCADE',
  );
  await client.query('INSERT INTO fin_invoices VALUES ($1,$2,$3)', [
    INVOICE,
    ORG,
    'synthetic-invoice',
  ]);
  await client.query('INSERT INTO stk_items VALUES ($1,$2,10)', [ITEM, ORG]);
  await client.query('INSERT INTO stk_warehouses VALUES ($1,$2)', [WH, ORG]);
  await client.query(
    'INSERT INTO stk_bins (org_id,item_id,warehouse_id,qty,valuation_rate) VALUES ($1,$2,$3,10,5)',
    [ORG, ITEM, WH],
  );
});

describe('invoice issue retry behavior on embedded PostgreSQL', () => {
  it('returns the established submitted result after response loss without another effect', async () => {
    boundaries.audit.mockRejectedValueOnce(new Error('synthetic post-commit response loss'));
    await expect(createIssueFromInvoice(ctx, input)).rejects.toThrow('response loss');
    const entry = await createIssueFromInvoice(ctx, input);
    expect(entry.status).toBe('submitted');
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    expect(boundaries.audit).toHaveBeenCalledTimes(1);
  });
  it('resumes the same draft after the creation/submission boundary', async () => {
    const draft = await createIssueFromInvoice(ctx, { ...input, submit: false });
    const submitted = await createIssueFromInvoice(ctx, input);
    expect(submitted.id).toBe(draft.id);
    expect(submitted.status).toBe('submitted');
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
  });
  it('retains insufficient-stock handling and recovers the same draft after replenishment', async () => {
    const request = { ...input, lines: [{ itemId: ITEM, qty: 12 }] };
    await expect(createIssueFromInvoice(ctx, request)).rejects.toMatchObject({
      code: 'negative_stock',
    });
    expect(await counts()).toEqual({ entries: 1, ledger: 0, qty: '10' });
    // Synthetic fixture replenishment; production correction must use normal receipts.
    await client.exec('UPDATE stk_bins SET qty=20');
    await createIssueFromInvoice(ctx, request);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
  });
  it('rejects an intervening draft edit before its locked submission', async () => {
    boundaries.afterTransaction.mockImplementationOnce(async () => {
      await client.exec('UPDATE stk_entry_lines SET qty=4');
    });
    await expect(createIssueFromInvoice(ctx, input)).rejects.toMatchObject({
      code: 'duplicate_invoice',
    });
    expect(await counts()).toEqual({ entries: 1, ledger: 0, qty: '10' });
  });
  it('rejects an intervening entry type change before submission', async () => {
    boundaries.afterTransaction.mockImplementationOnce(async () => {
      await client.exec("UPDATE stk_entries SET type='adjustment'");
    });
    await expect(createIssueFromInvoice(ctx, input)).rejects.toMatchObject({
      code: 'duplicate_invoice',
    });
    expect(await counts()).toEqual({ entries: 1, ledger: 0, qty: '10' });
  });
  it('rolls back a mid-submission database failure and retries the same draft', async () => {
    await client.exec(`CREATE FUNCTION fixture_fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic ledger interruption'; END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON stk_ledger FOR EACH ROW EXECUTE FUNCTION fixture_fail_ledger();`);
    try {
      await expect(createIssueFromInvoice(ctx, input)).rejects.toThrow();
      expect(await counts()).toEqual({ entries: 1, ledger: 0, qty: '10' });
    } finally {
      await client.exec(
        'DROP TRIGGER fixture_fail ON stk_ledger; DROP FUNCTION fixture_fail_ledger()',
      );
    }
    const before = (await client.query<{ id: string }>('SELECT id FROM stk_entries')).rows[0];
    const result = await createIssueFromInvoice(ctx, input);
    expect(result.id).toBe(before.id);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
  });
  it('rejects changed payload without changing the established draft', async () => {
    const original = await createIssueFromInvoice(ctx, { ...input, submit: false });
    await expect(
      createIssueFromInvoice(ctx, { ...input, lines: [{ itemId: ITEM, qty: 3 }] }),
    ).rejects.toMatchObject({ code: 'duplicate_invoice' });
    expect((await client.query('SELECT id,status FROM stk_entries')).rows).toEqual([
      { id: original.id, status: 'draft' },
    ]);
    expect((await counts()).ledger).toBe(0);
  });
  it('converts product-specific consumption quantities once per accepted issue', async () => {
    const request = { ...input, lines: [{ itemId: ITEM, qty: 999, qtyConsumption: 5 }] };
    const first = await createIssueFromInvoice(ctx, request);
    const again = await createIssueFromInvoice(ctx, request);
    expect(first.id).toBe(again.id);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '9.5' });
  });
  it('preserves cancelled history and permits one explicit replacement', async () => {
    const first = await createIssueFromInvoice(ctx, input);
    await cancelEntry(ctx, first.id, actor);
    const originalRows = (await client.query('SELECT * FROM stk_ledger ORDER BY id')).rows;
    const replacement = await createIssueFromInvoice(ctx, input);
    expect(replacement.id).not.toBe(first.id);
    expect((await client.query('SELECT * FROM stk_ledger ORDER BY id LIMIT 2')).rows).toEqual(
      originalRows,
    );
    expect(await counts()).toEqual({ entries: 2, ledger: 3, qty: '8' });
  });
  it('converges overlapping requests, while the generic submit API still rejects double-submit', async () => {
    const [a, b] = await Promise.all([
      createIssueFromInvoice(ctx, input),
      createIssueFromInvoice(ctx, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    await expect(submitEntry(ctx, a.id, actor)).rejects.toMatchObject({ code: 'not_draft' });
  });
  it('locks draft guards and rejects edits/deletion after submission without altering history', async () => {
    const draft = await createIssueFromInvoice(ctx, { ...input, submit: false });
    queries.length = 0;
    await updateEntry(ctx, draft.id, { note: 'synthetic note' });
    expect(
      queries.some(
        (query) =>
          query.startsWith('select') &&
          query.includes('"stk_entries"') &&
          query.endsWith('for update'),
      ),
    ).toBe(true);
    await createIssueFromInvoice(ctx, input);
    const ledger = (await client.query('SELECT * FROM stk_ledger ORDER BY id')).rows;
    await expect(updateEntry(ctx, draft.id, { lines: [] })).rejects.toMatchObject({
      code: 'not_draft',
    });
    queries.length = 0;
    await expect(deleteEntry(ctx, draft.id)).rejects.toMatchObject({ code: 'not_draft' });
    expect(
      queries.some(
        (query) =>
          query.startsWith('select') &&
          query.includes('"stk_entries"') &&
          query.endsWith('for update'),
      ),
    ).toBe(true);
    expect((await client.query('SELECT * FROM stk_ledger ORDER BY id')).rows).toEqual(ledger);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    expect(await updateEntry({ ...ctx, tenantId: OTHER }, draft.id, { note: 'denied' })).toBeNull();
    expect(await deleteEntry({ ...ctx, tenantId: OTHER }, draft.id)).toBe(false);
  });
  it('still permits deleting an unsubmitted draft', async () => {
    const draft = await createIssueFromInvoice(ctx, { ...input, submit: false });
    expect(await deleteEntry(ctx, draft.id)).toBe(true);
    expect(await counts()).toEqual({ entries: 0, ledger: 0, qty: '10' });
  });
  it('rejects a different tenant before any issue is created', async () => {
    await expect(createIssueFromInvoice({ ...ctx, tenantId: OTHER }, input)).rejects.toMatchObject({
      code: 'invoice_not_found',
    });
    expect((await counts()).entries).toBe(0);
  });
  it('finds legacy case/space IDs without rewriting their metadata', async () => {
    const draft = await createIssueFromInvoice(ctx, { ...input, submit: false });
    const legacy = { invoiceId: ` ${INVOICE.toUpperCase()} ` };
    await client.query('UPDATE stk_entries SET metadata=$1 WHERE id=$2', [
      JSON.stringify(legacy),
      draft.id,
    ]);
    expect((await findEntryByInvoice(ctx, INVOICE))?.id).toBe(draft.id);
    expect((await createIssueFromInvoice(ctx, input)).id).toBe(draft.id);
    expect(
      (await client.query('SELECT metadata FROM stk_entries WHERE id=$1', [draft.id])).rows,
    ).toEqual([{ metadata: legacy }]);
  });
  it.each([`{${INVOICE}}`, INVOICE.replaceAll('-', '')])(
    'uses locked canonical invoice identity for %s',
    async (invoiceId) => {
      const first = await createIssueFromInvoice(ctx, { ...input, invoiceId });
      const again = await createIssueFromInvoice(ctx, input);
      expect(first.id).toBe(again.id);
      expect(first.status).toBe('submitted');
      expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '8' });
    },
  );
  it.each(['item', 'warehouse'])(
    'rejects alternate/malformed %s IDs before any draft or ledger mutation',
    async (field) => {
      const original = field === 'item' ? ITEM : WH;
      for (const value of [`{${original}}`, original.replaceAll('-', ''), 'invalid-id']) {
        const request =
          field === 'item'
            ? { ...input, lines: [{ itemId: value, qty: 999, qtyConsumption: 5 }] }
            : { ...input, warehouseId: value };
        await expect(createIssueFromInvoice(ctx, request)).rejects.toMatchObject({
          code: 'invalid_line',
        });
        expect(await counts()).toEqual({ entries: 0, ledger: 0, qty: '10' });
        expect((await client.query('SELECT * FROM stk_entry_lines')).rows).toEqual([]);
      }
    },
  );
  it('normalizes uppercase/space IDs before authoritative consumption conversion and retry', async () => {
    // Include hex letters so case normalization is actually exercised.
    const item = '30000000-0000-4000-8000-abcdef000001';
    const warehouse = '40000000-0000-4000-8000-abcdef000001';
    await client.query('UPDATE stk_items SET id=$1', [item]);
    await client.query('UPDATE stk_warehouses SET id=$1', [warehouse]);
    await client.query('UPDATE stk_bins SET item_id=$1,warehouse_id=$2', [item, warehouse]);
    const first = await createIssueFromInvoice(ctx, {
      ...input,
      warehouseId: ` ${warehouse.toUpperCase()} `,
      lines: [{ itemId: ` ${item.toUpperCase()} `, qty: 999, qtyConsumption: 5 }],
    });
    const again = await createIssueFromInvoice(ctx, {
      ...input,
      warehouseId: warehouse,
      lines: [{ itemId: item, qty: 999, qtyConsumption: 5 }],
    });
    expect(first.id).toBe(again.id);
    expect(await counts()).toEqual({ entries: 1, ledger: 1, qty: '9.5' });
  });
  it('uses canonical invoice UUID identity for case variants', async () => {
    const first = await createIssueFromInvoice(ctx, { ...input, invoiceId: INVOICE.toUpperCase() });
    const again = await createIssueFromInvoice(ctx, input);
    expect(first.id).toBe(again.id);
  });
});

describe('additive identity migration and preflight', () => {
  it('the Drizzle index independently enforces the same identity boundary', async () => {
    const config = getTableConfig(stkEntries).indexes.find(
      (index) => index.config.name === 'stk_entries_org_active_invoice_issue_uniq',
    )?.config;
    if (!config?.where || !is(config.columns[1], SQL))
      throw new Error('Missing source expression index');
    expect(config.unique).toBe(true);
    const dialect = new PgDialect();
    const expression = dialect.sqlToQuery(config.columns[1]);
    const predicate = dialect.sqlToQuery(config.where);
    expect([...expression.params, ...predicate.params]).toEqual([]);
    await client.exec(`CREATE UNIQUE INDEX fixture_source_invoice ON stk_entries
      (org_id, (${expression.sql.replaceAll('"stk_entries".', '')})) WHERE ${predicate.sql};
      DROP INDEX stk_entries_org_active_invoice_issue_uniq;`);
    try {
      await addEntry(ORG, 'draft', { invoiceId: INVOICE });
      await expect(
        addEntry(ORG, 'submitted', { invoiceId: ` ${INVOICE.toUpperCase()} ` }),
      ).rejects.toThrow();
      await addEntry(OTHER, 'submitted', { invoiceId: INVOICE });
      await addEntry(ORG, 'cancelled', { invoiceId: INVOICE });
      await addEntry(ORG, 'draft', {});
      await addEntry(ORG, 'draft', {});
      expect((await client.query(invoiceCollisionSql)).rows).toEqual([]);
    } finally {
      await client.exec(
        'DROP INDEX fixture_source_invoice; TRUNCATE stk_entry_lines, stk_entries CASCADE',
      );
      await client.exec(migration);
    }
  });

  it('rejects active duplicates, including case/space variants, but accepts cross-org and cancelled histories', async () => {
    await addEntry(ORG, 'submitted', { invoiceId: INVOICE });
    await expect(
      addEntry(ORG, 'draft', { invoiceId: ` ${INVOICE.toUpperCase()} `, source: 'manual' }),
    ).rejects.toThrow();
    await addEntry(OTHER, 'draft', { invoiceId: INVOICE });
    await addEntry(ORG, 'cancelled', { invoiceId: INVOICE });
    await addEntry(ORG, 'draft', {});
    await addEntry(ORG, 'draft', {});
    expect((await client.query(invoiceCollisionSql)).rows).toEqual([]);
  });
  it('rolls back a colliding migration without changing historical rows', async () => {
    await client.exec('DROP INDEX stk_entries_org_active_invoice_issue_uniq');
    await addEntry(ORG, 'draft', { invoiceId: INVOICE });
    await addEntry(ORG, 'submitted', { invoiceId: INVOICE.toUpperCase() });
    const before = (await client.query('SELECT * FROM stk_entries ORDER BY id')).rows;
    expect((await client.query(invoiceCollisionSql)).rows).toHaveLength(1);
    await expect(client.exec(migration)).rejects.toThrow('Duplicate active invoice issues');
    await client.exec('ROLLBACK');
    expect((await client.query('SELECT * FROM stk_entries ORDER BY id')).rows).toEqual(before);
    // Reset only disposable fixture data so subsequent tests retain the invariant.
    await client.exec('TRUNCATE stk_entry_lines, stk_entries CASCADE');
    await client.exec(migration);
  });
  it.each([null, '', 42])(
    'reports invalid identity %s and aborts migration without a rewrite',
    async (identity) => {
      await client.exec('DROP INDEX stk_entries_org_active_invoice_issue_uniq');
      await addEntry(ORG, 'draft', { invoiceId: identity });
      expect((await client.query(invoiceInvalidIdentitySql)).rows).toHaveLength(1);
      await expect(client.exec(migration)).rejects.toThrow('Invalid active invoice issue identity');
      await client.exec('ROLLBACK');
      expect((await client.query('SELECT metadata FROM stk_entries')).rows).toEqual([
        { metadata: { invoiceId: identity } },
      ]);
      await client.exec('TRUNCATE stk_entry_lines, stk_entries CASCADE');
      await client.exec(migration);
    },
  );
  it('rejects unsafe or missing CLI mode without any database access', () => {
    expect(() => validatePreflightArgs(['--read-only'])).not.toThrow();
    for (const args of [[], ['--apply'], ['--read-only', '--apply']])
      expect(() => validatePreflightArgs(args)).toThrow();
  });
});
