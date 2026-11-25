// Spec 142 — canje (stock exchange with a supplier) on embedded PostgreSQL:
// submit carries the outgoing value into the incoming lines in one
// transaction, a shortage refuses with the facts and moves nothing, cancel
// reverses both sides, and finance never counts it as consumption.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';

// postgres.js `execute` resolves to the row array; PGlite's resolves to { rows }.
// Adapt it so the services' raw-SQL readers (finance COGS, daily flow) run unchanged.
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
import {
  createEntry,
  submitEntry,
  cancelEntry,
  getStockDailyFlow,
  itemSupplyInfo,
} from './stock.service';
import { financeSummary } from './finance.service';

const client = new PGlite();
const db = drizzle(client);
const ORG = '10000000-0000-4000-8000-000000000001';
const PARTY = '50000000-0000-4000-8000-000000000001';
const FILLER = '30000000-0000-4000-8000-000000000001';
const VOLUME = '30000000-0000-4000-8000-000000000002';
const OTHER = '30000000-0000-4000-8000-000000000003';
const WH = '40000000-0000-4000-8000-000000000001';
const ctx: CoreCtx = { tenantId: ORG, db: db as unknown as CoreCtx['db'] };
const actor = { id: null, name: null };

const out = (itemId: string, qty: number) => ({ itemId, qty, fromWarehouseId: WH });
const inn = (itemId: string, qty: number) => ({ itemId, qty, toWarehouseId: WH });

async function bins() {
  const { rows } = await client.query<{ item_id: string; qty: string; valuation_rate: string }>(
    'SELECT item_id, qty::text, valuation_rate::text FROM stk_bins ORDER BY item_id',
  );
  return Object.fromEntries(
    rows.map((r) => [r.item_id, [Number(r.qty), Number(r.valuation_rate)]]),
  );
}
async function stockValue() {
  const { rows } = await client.query<{ v: string }>(
    'SELECT coalesce(sum(qty * valuation_rate), 0)::text v FROM stk_bins',
  );
  return Math.round(Number(rows[0].v) * 10_000) / 10_000;
}
async function exchange(lines: Array<ReturnType<typeof out> | ReturnType<typeof inn>>) {
  return createEntry(ctx, { type: 'exchange', partyId: PARTY, lines }, actor);
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
    CREATE TABLE fin_invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      total numeric, subtotal numeric, discount numeric, tax numeric, status text, client_id uuid,
      client_doc_number text, currency text, issued_at timestamptz, shadowed boolean NOT NULL DEFAULT false);
    CREATE TABLE fin_invoice_items (invoice_id uuid, total numeric);
    CREATE TABLE parties (id uuid PRIMARY KEY, org_id text NOT NULL, name text);
    -- cancelling a receipt reads the record-lock inputs (spec 140)
    CREATE TABLE org_lock_policy (org_id text PRIMARY KEY, month_enabled boolean NOT NULL DEFAULT true,
      days_enabled boolean NOT NULL DEFAULT false, days integer, sunat_enabled boolean NOT NULL DEFAULT false,
      webhook_enabled boolean NOT NULL DEFAULT false, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE org_record_locks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      lifted_at timestamptz);
    CREATE TABLE org_lock_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      action text NOT NULL, record_type text, record_id uuid, rules jsonb NOT NULL DEFAULT '[]',
      actor_kind text NOT NULL, actor_id uuid, actor_name text, reason text,
      detail jsonb NOT NULL DEFAULT '{}', ref_event_id uuid, expires_at timestamptz,
      occurred_at timestamptz NOT NULL DEFAULT now());
    CREATE UNIQUE INDEX org_lock_events_used_uniq ON org_lock_events (org_id, ref_event_id) WHERE action = 'unlock_used';
    CREATE TABLE fin_settings (org_id text PRIMARY KEY, timezone text);
    CREATE TABLE pos_period_locks (org_id text NOT NULL, period text NOT NULL);
    CREATE TABLE stk_corrections (org_id text, kind text, source_entry_id uuid, replacement_entry_id uuid);
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
    'TRUNCATE org_lock_events, org_lock_policy, pos_period_locks, stk_ledger, stk_bins, stk_entry_lines, stk_entries, stk_items, stk_warehouses CASCADE',
  );
  await client.query(
    `INSERT INTO stk_items (id, org_id, code, name) VALUES
      ($1,$4,'FIL','HA Saypha Filler'), ($2,$4,'VOL','HA Saypha Volume'), ($3,$4,'OTH','Other')`,
    [FILLER, VOLUME, OTHER, ORG],
  );
  await client.query('INSERT INTO stk_warehouses (id, org_id) VALUES ($1,$2)', [WH, ORG]);
  await client.query(
    "INSERT INTO fin_settings (org_id, timezone) VALUES ($1,'America/Lima') ON CONFLICT DO NOTHING",
    [ORG],
  );
  // 30 Filler at S/ 250 average; 5 Volume already on hand at S/ 300.
  await client.query(
    `INSERT INTO stk_bins (org_id,item_id,warehouse_id,qty,valuation_rate) VALUES
      ($1,$2,$4,30,250), ($1,$3,$4,5,300)`,
    [ORG, FILLER, VOLUME, WH],
  );
});

describe('canje submit (spec 142)', () => {
  it('moves both sides in one movement: incoming valued at the outgoing average, stock value unchanged', async () => {
    const before = await stockValue();
    const draft = await exchange([out(FILLER, 20), inn(VOLUME, 20)]);
    // Drafts move nothing.
    expect(await bins()).toEqual({ [FILLER]: [30, 250], [VOLUME]: [5, 300] });

    const posted = await submitEntry(ctx, draft.id, actor);
    expect(posted).toMatchObject({ status: 'submitted', humanId: 'STE-FIXTURE', type: 'exchange' });
    // Volume: 5 @ 300 + 20 @ 250 = 6500 / 25 = 260.
    expect(await bins()).toEqual({ [FILLER]: [10, 250], [VOLUME]: [25, 260] });
    expect(await stockValue()).toBe(before);

    const { rows: ledger } = await client.query<{ item_id: string; value_delta: string }>(
      'SELECT item_id, value_delta::text FROM stk_ledger ORDER BY id',
    );
    // Out leg first, then in; the two values cancel.
    expect(ledger.map((r) => [r.item_id, Number(r.value_delta)])).toEqual([
      [FILLER, -5000],
      [VOLUME, 5000],
    ]);
    const { rows: lines } = await client.query<{ item_id: string; rate: string | null }>(
      'SELECT item_id, rate::text FROM stk_entry_lines ORDER BY item_id',
    );
    // Both sides record their unit cost: the average consumed and the carried value.
    expect(lines.map((l) => [l.item_id, Number(l.rate)])).toEqual([
      [FILLER, 250],
      [VOLUME, 250],
    ]);
  });

  it('spreads an uneven trade by quantity and keeps the value to the cent', async () => {
    await client.exec(`UPDATE stk_bins SET valuation_rate = 100 WHERE item_id = '${FILLER}'`);
    const before = await stockValue();
    const draft = await exchange([out(FILLER, 10), inn(VOLUME, 3), inn(OTHER, 1)]);
    await submitEntry(ctx, draft.id, actor);
    const { rows } = await client.query<{ item_id: string; value_delta: string }>(
      'SELECT item_id, value_delta::text FROM stk_ledger WHERE qty_delta > 0 ORDER BY item_id',
    );
    expect(rows.map((r) => [r.item_id, Number(r.value_delta)])).toEqual([
      [VOLUME, 750],
      [OTHER, 250],
    ]);
    expect(await stockValue()).toBe(before);
  });

  it('refuses a shortage with the item, on-hand and requested qty, and writes nothing', async () => {
    await client.exec(`UPDATE stk_bins SET qty = 13 WHERE item_id = '${FILLER}'`);
    const draft = await exchange([out(FILLER, 20), inn(VOLUME, 20)]);
    await expect(submitEntry(ctx, draft.id, actor)).rejects.toMatchObject({
      code: 'negative_stock',
      details: { item: 'HA Saypha Filler', onHand: 13, requested: 20 },
    });
    expect(await bins()).toEqual({ [FILLER]: [13, 250], [VOLUME]: [5, 300] });
    const { rows } = await client.query<{ n: number; rate: string | null; status: string }>(
      `SELECT (SELECT count(*)::int FROM stk_ledger) n,
              (SELECT rate::text FROM stk_entry_lines WHERE item_id = '${VOLUME}') rate,
              (SELECT status FROM stk_entries) status`,
    );
    expect(rows[0]).toEqual({ n: 0, rate: null, status: 'draft' });
  });

  it('refuses at submit: no supplier, one side only, an item on both sides', async () => {
    const noParty = await createEntry(
      ctx,
      { type: 'exchange', partyId: null, lines: [out(FILLER, 1), inn(VOLUME, 1)] },
      actor,
    );
    await expect(submitEntry(ctx, noParty.id, actor)).rejects.toMatchObject({
      code: 'exchange_party_required',
    });
    const oneSide = await exchange([out(FILLER, 1)]);
    await expect(submitEntry(ctx, oneSide.id, actor)).rejects.toMatchObject({
      code: 'exchange_needs_both_sides',
    });
    const bothSides = await exchange([out(FILLER, 1), inn(FILLER, 1)]);
    await expect(submitEntry(ctx, bothSides.id, actor)).rejects.toMatchObject({
      code: 'exchange_item_both_sides',
    });
    expect(await bins()).toEqual({ [FILLER]: [30, 250], [VOLUME]: [5, 300] });
  });

  it('cancel reverses both sides together', async () => {
    const draft = await exchange([out(FILLER, 20), inn(VOLUME, 20)]);
    await submitEntry(ctx, draft.id, actor);
    const cancelled = await cancelEntry(ctx, draft.id, actor);
    expect(cancelled.status).toBe('cancelled');
    expect(await bins()).toEqual({ [FILLER]: [30, 250], [VOLUME]: [5, 300] });
  });
});

describe('cancelling a receipt meets the record lock (spec 140)', () => {
  const receipt = async () => {
    const draft = await createEntry(
      ctx,
      { type: 'receipt', lines: [{ itemId: FILLER, qty: 2, rate: 100, toWarehouseId: WH }] },
      actor,
    );
    return submitEntry(ctx, draft.id, actor);
  };

  /** Back-date the receipt 70 days and close its month; returns the month. */
  const closeMonthOf = async (id: string) => {
    await client.query(
      "UPDATE stk_entries SET posted_at = now() - interval '70 days' WHERE id = $1",
      [id],
    );
    const { rows } = await client.query<{ p: string }>(
      "SELECT to_char((now() - interval '70 days') AT TIME ZONE 'America/Lima', 'YYYY-MM') AS p",
    );
    await client.query('INSERT INTO pos_period_locks (org_id, period) VALUES ($1, $2)', [
      ORG,
      rows[0]!.p,
    ]);
    return rows[0]!.p;
  };

  it('refuses a receipt posted in a closed month and leaves stock and status untouched', async () => {
    const posted = await receipt();
    await client.query(
      "UPDATE stk_entries SET posted_at = now() - interval '70 days' WHERE id = $1",
      [posted.id],
    );
    await client.query(
      "INSERT INTO pos_period_locks (org_id, period) VALUES ($1, to_char((now() - interval '70 days') AT TIME ZONE 'America/Lima', 'YYYY-MM'))",
      [ORG],
    );
    await expect(cancelEntry(ctx, posted.id, actor)).rejects.toMatchObject({
      code: 'period_locked',
      detail: { locks: [expect.objectContaining({ rule: 'month', kind: 'month' })] },
    });
    const { rows } = await client.query<{ status: string }>(
      'SELECT status FROM stk_entries WHERE id = $1',
      [posted.id],
    );
    expect(rows[0]!.status).toBe('submitted');
    expect((await bins())[FILLER]![0]).toBe(32);
  });

  it('lets an active owner unlock through once and uses it up in the same commit (probe R3d)', async () => {
    const posted = await receipt();
    const period = await closeMonthOf(posted.id);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO org_lock_events (org_id, action, record_type, record_id, rules, actor_kind, actor_name, reason, expires_at)
       VALUES ($1, 'unlock', 'stock_receipt', $2, $3::jsonb, 'person', 'Owner', 'audit fix', now() + interval '1 hour') RETURNING id`,
      [
        ORG,
        posted.id,
        JSON.stringify([{ rule: 'month', kind: 'month', unlockable: true, period }]),
      ],
    );
    expect((await cancelEntry(ctx, posted.id, actor)).status).toBe('cancelled');
    const used = await client.query(
      "SELECT ref_event_id FROM org_lock_events WHERE action = 'unlock_used' AND record_id = $1",
      [posted.id],
    );
    expect(used.rows).toEqual([{ ref_event_id: rows[0]!.id }]);
  });

  it('an unlock granted for another receipt does not open this one', async () => {
    const posted = await receipt();
    const period = await closeMonthOf(posted.id);
    await client.query(
      `INSERT INTO org_lock_events (org_id, action, record_type, record_id, rules, actor_kind, reason, expires_at)
       VALUES ($1, 'unlock', 'stock_receipt', gen_random_uuid(), $2::jsonb, 'person', 'other', now() + interval '1 hour')`,
      [ORG, JSON.stringify([{ rule: 'month', kind: 'month', unlockable: true, period }])],
    );
    await expect(cancelEntry(ctx, posted.id, actor)).rejects.toMatchObject({
      code: 'period_locked',
    });
  });

  it('still cancels a receipt of the current month', async () => {
    const posted = await receipt();
    expect((await cancelEntry(ctx, posted.id, actor)).status).toBe('cancelled');
    expect((await bins())[FILLER]![0]).toBe(30);
  });
  it('an org without finance settings still cancels, as before spec 140 (FR-006)', async () => {
    const posted = await receipt();
    await client.query('DELETE FROM fin_settings WHERE org_id = $1', [ORG]);
    expect((await cancelEntry(ctx, posted.id, actor)).status).toBe('cancelled');
  });

  it('an org that saved its own lock rules but has no finance settings fails closed', async () => {
    const posted = await receipt();
    await client.query('DELETE FROM fin_settings WHERE org_id = $1', [ORG]);
    await client.query('INSERT INTO org_lock_policy (org_id) VALUES ($1)', [ORG]);
    await expect(cancelEntry(ctx, posted.id, actor)).rejects.toMatchObject({
      code: 'policy_unverified',
    });
  });
});

describe('canje in finance (FR-006)', () => {
  it('contributes 0 to consumption cost while an issue still counts', async () => {
    const swap = await exchange([out(FILLER, 20), inn(VOLUME, 20)]);
    await submitEntry(ctx, swap.id, actor);
    expect((await financeSummary(ctx, { from: null, to: null, bucket: 'month' })).totalCogs).toBe(
      0,
    );
    const [flow] = await getStockDailyFlow(ctx, 1);
    expect(flow).toMatchObject({ valueDelta: 0, usedValue: 0 });

    const issue = await createEntry(
      ctx,
      { type: 'issue', lines: [{ itemId: FILLER, qty: 2, fromWarehouseId: WH }] },
      actor,
    );
    await submitEntry(ctx, issue.id, actor);
    expect((await financeSummary(ctx, { from: null, to: null, bucket: 'month' })).totalCogs).toBe(
      500,
    );
  });
});

describe('last purchase cost reads registered receipts only', () => {
  const receipt = (itemId: string, qty: number, rate: number) =>
    createEntry(ctx, { type: 'receipt', lines: [{ itemId, qty, rate, toWarehouseId: WH }] }, actor);

  it('a canje after a purchase does not replace the purchase cost', async () => {
    const bought = await receipt(VOLUME, 10, 280);
    await submitEntry(ctx, bought.id, actor);
    const swap = await exchange([out(FILLER, 20), inn(VOLUME, 20)]);
    await submitEntry(ctx, swap.id, actor);
    expect((await itemSupplyInfo(ctx)).get(VOLUME)?.lastRestockCost).toBe(280);
  });

  it('a cancelled purchase and its reversal are not a purchase', async () => {
    const first = await receipt(OTHER, 4, 90);
    await submitEntry(ctx, first.id, actor);
    const wrong = await receipt(OTHER, 4, 900);
    await submitEntry(ctx, wrong.id, actor);
    await cancelEntry(ctx, wrong.id, actor);
    expect((await itemSupplyInfo(ctx)).get(OTHER)?.lastRestockCost).toBe(90);
  });
});
