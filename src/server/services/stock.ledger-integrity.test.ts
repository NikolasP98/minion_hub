// Spec 144 — stock value always adds up, on embedded PostgreSQL: when a cancel
// leaves value the moving average cannot carry, the same transaction books a
// value-only residual row, so Σ value_delta = qty × average after every
// posting; ledgerValueGaps finds any item where that no longer holds.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';

// postgres.js `execute` resolves to the row array; PGlite's resolves to { rows }.
type Tx = { execute: (q: unknown) => Promise<{ rows: unknown[] }> };
vi.mock('$server/db/pg-client', () => ({
  getOrgTransactionDb: (db: { transaction: (cb: (tx: Tx) => unknown) => Promise<unknown> }) => ({
    transaction: (cb: (tx: unknown) => unknown) =>
      db.transaction((tx) =>
        cb(
          new Proxy(tx, {
            get: (t, p) =>
              p === 'execute' ? async (q: unknown) => (await t.execute(q)).rows : Reflect.get(t, p),
          }),
        ),
      ),
  }),
}));
vi.mock('./activity.service', () => ({ recordAudit: vi.fn() }));
vi.mock('./notif.service', () => ({ registerNotifCandidateSource: vi.fn() }));
vi.mock('./naming-series', () => ({ nextSerialId: async () => 'STE-FIXTURE' }));
vi.mock('@minion-stack/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@minion-stack/cache')>()),
  cached: (_key: unknown, _opts: unknown, fn: () => unknown) => fn(),
}));
import { createEntry, submitEntry, cancelEntry, ledgerValueGaps } from './stock.service';

const client = new PGlite();
const db = drizzle(client);
const ORG = '10000000-0000-4000-8000-000000000001';
const ITEM = '30000000-0000-4000-8000-000000000001';
const WH = '40000000-0000-4000-8000-000000000001';
const ctx: CoreCtx = { tenantId: ORG, db: db as unknown as CoreCtx['db'] };
const actor = { id: null, name: null };

async function post(type: 'receipt' | 'issue', qty: number, rate?: number) {
  const line =
    type === 'receipt'
      ? { itemId: ITEM, qty, rate, toWarehouseId: WH }
      : { itemId: ITEM, qty, fromWarehouseId: WH };
  const draft = await createEntry(ctx, { type, lines: [line] }, actor);
  await submitEntry(ctx, draft.id, actor);
  return draft.id;
}
/** Σ ledger value vs the bin's qty × rate, to the cent. */
async function books() {
  const { rows } = await client.query<{ sum: string; value: string }>(
    `SELECT (SELECT coalesce(sum(value_delta),0) FROM stk_ledger)::text sum,
            (SELECT coalesce(sum(qty*valuation_rate),0) FROM stk_bins)::text value`,
  );
  const r2 = (n: string) => Math.round(Number(n) * 100) / 100;
  return { sum: r2(rows[0].sum), value: r2(rows[0].value) };
}
async function residualRows() {
  const { rows } = await client.query<{ value_delta: string }>(
    'SELECT value_delta::text FROM stk_ledger WHERE qty_delta = 0 ORDER BY id',
  );
  return rows.map((r) => Number(r.value_delta));
}

beforeAll(async () => {
  await client.exec(`CREATE ROLE app_ledger;
    CREATE TABLE stk_items (id uuid PRIMARY KEY, org_id text NOT NULL, code text NOT NULL, name text NOT NULL);
    CREATE TABLE stk_warehouses (id uuid PRIMARY KEY, org_id text NOT NULL, archived_at timestamptz);
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
}, 30_000);
afterAll(async () => {
  await client.close();
});
beforeEach(async () => {
  await client.exec(
    'TRUNCATE stk_ledger, stk_bins, stk_entry_lines, stk_entries, stk_items, stk_warehouses CASCADE',
  );
  await client.query(
    `INSERT INTO stk_items (id, org_id, code, name) VALUES ($1,$2,'VOL','HA Saypha Volume')`,
    [ITEM, ORG],
  );
  await client.query('INSERT INTO stk_warehouses (id, org_id) VALUES ($1,$2)', [WH, ORG]);
});

describe('valuation residual (FR-001)', () => {
  it('cancel after a partial issue at a different average books the value the average cannot carry', async () => {
    await post('receipt', 3, 10); // 3 @ 10
    const dear = await post('receipt', 1, 1000); // 4 @ 257.50
    await post('issue', 1); // 3 @ 257.50
    expect(await residualRows()).toEqual([]);
    expect(await books()).toEqual({ sum: 772.5, value: 772.5 });

    // Taking the S/ 1,000 unit back out would leave -227.50 for 2 units: the
    // average stays 257.50 and the difference is booked, not dropped.
    await cancelEntry(ctx, dear, actor);
    expect(await residualRows()).toEqual([742.5]);
    expect(await books()).toEqual({ sum: 515, value: 515 });
    expect(await ledgerValueGaps(ctx)).toEqual([]);
  });

  it('drain to zero after a cancel reversal leaves both value and movements at 0', async () => {
    const cheap = await post('receipt', 1, 100);
    await post('receipt', 1, 500); // 2 @ 300
    const sale = await post('issue', 1); // 1 @ 300
    await cancelEntry(ctx, cheap, actor); // the last unit leaves at its old cost 100
    expect(await residualRows()).toEqual([-200]);
    expect(await books()).toEqual({ sum: 0, value: 0 });

    // Undoing the sale brings the unit back at the cost it left with.
    await cancelEntry(ctx, sale, actor);
    expect(await books()).toEqual({ sum: 300, value: 300 });
    expect(await ledgerValueGaps(ctx)).toEqual([]);
  });

  it('a healthy sequence posts no residual rows', async () => {
    await post('receipt', 10, 5);
    await post('receipt', 10, 15);
    await post('issue', 5);
    expect(await residualRows()).toEqual([]);
    expect(await books()).toEqual({ sum: 150, value: 150 });
  });
});

describe('ledgerValueGaps (FR-002)', () => {
  it('finds an item whose movements disagree with its value, and the first movement that diverged', async () => {
    await post('receipt', 2, 100);
    const late = await post('receipt', 1, 400); // 3 @ 200, Σ 600
    // A hand-written bin row (what the repair script did): value 3 × 250 = 750.
    await client.query('UPDATE stk_bins SET valuation_rate = 250');
    await client.query(
      `UPDATE stk_ledger SET valuation_rate = 250 WHERE id = (SELECT max(id) FROM stk_ledger)`,
    );

    const gaps = await ledgerValueGaps(ctx);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      itemId: ITEM,
      itemName: 'HA Saypha Volume',
      warehouseId: WH,
      gap: 150,
      since: { entryId: late, type: 'receipt', humanId: 'STE-FIXTURE' },
    });
  });

  it('names the real culprit, not an earlier healthy movement that booked a residual', async () => {
    await post('receipt', 3, 10);
    const dear = await post('receipt', 1, 1000);
    await post('issue', 1);
    await cancelEntry(ctx, dear, actor); // healthy: posts a residual row
    const late = await post('receipt', 1, 50);
    await client.query('UPDATE stk_bins SET valuation_rate = valuation_rate + 1');
    await client.query(
      `UPDATE stk_ledger SET valuation_rate = valuation_rate + 1 WHERE id = (SELECT max(id) FROM stk_ledger)`,
    );
    const [gap] = await ledgerValueGaps(ctx);
    expect(gap.since).toMatchObject({ entryId: late });
  });

  it('is empty when every item adds up', async () => {
    await post('receipt', 2, 100);
    await post('issue', 1);
    expect(await ledgerValueGaps(ctx)).toEqual([]);
  });
});
