import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { describe, expect, it, vi } from 'vitest';

/**
 * Real-PostgreSQL proofs for the POS sellable write paths. PR #142/#149 (the
 * same spec, twice) both failed because every claim here was asserted through
 * mocks: the "concurrent double-PATCH" test made ONE call with a mock
 * preconfigured to throw 23505, and the create/update parity test compared
 * mock call arguments. This file runs the SHIPPED code against a real database
 * and asserts on persisted rows read back from an INDEPENDENT connection.
 *
 * Four properties are covered:
 *  1. the concurrent false→true trackStock race resolves through the real
 *     partial unique index `stk_items_org_fin_product_uniq` (companion
 *     migration 20260719230000_stk_items_fin_product_uniq.sql), surfacing the
 *     loser as PosError('item_taken') rather than a raw 500;
 *  2. updateSellable's item/uom write and its fin_products write are ONE
 *     transaction — a forced failure of the later product write leaves neither
 *     side committed;
 *  3. `itemHasHistory` sees billing history reached through
 *     `fin_invoice_items.product_id` (the alias-resolved link finance.service
 *     writes), not only through a live code match;
 *  4. createSellable(trackStock) and createSellable(service)+updateSellable(
 *     trackStock) persist byte-identical fin_products/stk_items rows and
 *     return identical projections.
 *
 * ★ `withOrgCore` is replaced with a TRANSACTION-FAITHFUL adapter
 * (`scope.db.transaction(fn)`), not with a bare pass-through: the atomicity
 * property above is only observable if the callback really runs inside one
 * transaction. Only the RLS role / GUC setup is skipped — the bare
 * `postgres:15` CI service has no `app_ledger` role, and every claim here
 * rests on real constraints, locks and transaction boundaries rather than on
 * RLS. Each test still uses its own throwaway schema, and the concurrency
 * test drives two DISTINCT physical connections so its race is genuine
 * network-level concurrency rather than two calls serialized on one socket.
 *
 * fin_products/stk_items/stk_warehouses/stk_bins/stk_consumption/
 * fin_product_components/stk_ledger/stk_entry_lines all have in-repo CREATE
 * TABLE migrations (unlike organizations/crm_activities — see
 * hub-supabase-schema-not-reproducible.md). `fin_invoice_items` does not, so
 * the columns this suite touches (org_id, code, product_id) are mirrored from
 * `pg-finance-schema.ts` below. No full-schema database is required.
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

if (process.env.REQUIRE_POS_TRACKSTOCK_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_POS_TRACKSTOCK_POSTGRES is set but SUPABASE_DB_URL is empty — this suite needs a ' +
      'real PostgreSQL connection to prove the concurrent-PATCH unique-index race.',
  );
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: <T>(
    scope: { db: { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> } },
    fn: (tx: never) => Promise<T>,
  ) => scope.db.transaction((tx) => (fn as (tx: unknown) => Promise<T>)(tx)),
}));

const { createSellable, updateSellable, PosError } = await import('./pos.service');
const { createEntry, createSourcedIssue, createIssueFromInvoice } = await import('./stock.service');
const { upsertInvoicesBatch } = await import('./finance.service');

type Client = ReturnType<typeof postgres>;

const ORG_ID = 'org-pos-integration';
const ACTOR = { id: 'u1', name: 'Integration Tester' };

/** Columns mirrored from the in-repo migrations / drizzle schema for the
 *  tables these paths read and write.
 *
 *  ★ These are FULL row contracts, not just the columns an assertion reads
 *  back. A drizzle insert names every column of the values object it is
 *  given, so a fixture table that merely omits a column the shipped writer
 *  always sends fails the whole statement with 42703 (`column … does not
 *  exist`) — the suite would then be reporting a fixture defect as a
 *  behavioural one. `stk_entry_lines` is the live example: `linesToRows`
 *  (stock.service.ts) always emits from_warehouse_id/to_warehouse_id, so both
 *  must exist here, with their real `stk_warehouses` foreign keys, for
 *  createEntry to run at all. */
const DDL = `
  create table fin_products (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    sku uuid not null default gen_random_uuid(),
    code text not null,
    name text not null,
    category text,
    unit_price numeric,
    active boolean not null default true,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (org_id, code)
  );
  create table stk_items (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    sku uuid not null default gen_random_uuid(),
    code text not null,
    name text not null,
    uom text not null default 'unit',
    item_group text,
    is_stock_item boolean not null default true,
    reorder_level numeric,
    reorder_qty numeric,
    moq numeric,
    default_supplier_party_id uuid,
    consumption_uom text,
    units_per_stock_uom numeric,
    subunits_per_stock_uom numeric,
    diagram_enabled boolean not null default false,
    unit_svg text,
    subunit_svg text,
    valuation_method text not null default 'moving_avg',
    fin_product_id uuid,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (org_id, code),
    unique (org_id, fin_product_id)
  );
  create table stk_warehouses (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    name text not null,
    parent_id uuid references stk_warehouses (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table stk_bins (
    org_id text not null,
    item_id uuid not null references stk_items (id),
    warehouse_id uuid not null references stk_warehouses (id),
    qty numeric not null default 0,
    valuation_rate numeric not null default 0,
    updated_at timestamptz not null default now(),
    primary key (org_id, item_id, warehouse_id)
  );
  create table stk_entries (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    human_id text,
    type text not null,
    status text not null default 'draft',
    party_id uuid,
    note text,
    posted_at timestamptz,
    created_by text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table stk_entry_lines (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    entry_id uuid not null references stk_entries (id) on delete cascade,
    item_id uuid not null references stk_items (id),
    qty numeric not null,
    uom text,
    rate numeric,
    from_warehouse_id uuid references stk_warehouses (id),
    to_warehouse_id uuid references stk_warehouses (id),
    line_no integer not null default 0
  );
  create table stk_ledger (
    id bigserial primary key,
    org_id text not null,
    item_id uuid not null references stk_items (id),
    warehouse_id uuid not null references stk_warehouses (id),
    qty_delta numeric not null,
    created_at timestamptz not null default now()
  );
  create table fin_invoice_items (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    invoice_id uuid,
    product_id uuid references fin_products (id) on delete set null,
    code text,
    description text,
    category text,
    quantity numeric,
    unit_price numeric,
    discount numeric,
    tax numeric,
    total numeric,
    metadata jsonb not null default '{}'
  );
  create table fin_clients (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    provider text not null,
    provider_ref text not null,
    name text,
    doc_type text,
    doc_number text,
    email text,
    phone text,
    metadata jsonb not null default '{}',
    unique (org_id, provider, provider_ref)
  );
  create table fin_payments (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    invoice_id uuid not null,
    provider_ref text,
    method text,
    paid_at timestamptz,
    amount numeric,
    status text,
    metadata jsonb not null default '{}'
  );
  create table doc_audit_log (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    ref_type text not null,
    ref_id uuid not null,
    actor_id uuid,
    actor_name text,
    op text not null default 'update',
    changes jsonb not null default '[]',
    occurred_at timestamptz not null default now()
  );
  create table stk_consumption (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    fin_product_id uuid not null,
    item_id uuid not null,
    qty_per_unit numeric not null,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table fin_product_components (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    bundle_product_id uuid not null,
    child_product_id uuid not null,
    qty numeric not null default 1,
    line_no integer not null default 0,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table fin_invoices (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    provider text not null,
    provider_ref text not null,
    number text,
    document_id text,
    issued_at timestamptz,
    client_id uuid,
    client_name text,
    client_doc_type text,
    client_doc_number text,
    client_email text,
    currency text,
    subtotal numeric,
    tax numeric,
    discount numeric,
    total numeric,
    status text,
    seller text,
    note text,
    shadowed boolean not null default false,
    metadata jsonb not null default '{}',
    synced_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (org_id, provider, provider_ref)
  );
`;

/** One throwaway schema per test, plus `extraConnections` additional physical
 *  connections for genuinely concurrent work. `owner` is never used by the
 *  code under test — it is the independent connection every assertion reads
 *  persisted state through. */
async function withSchema<T>(
  extraConnections: number,
  run: (env: { schema: string; owner: Client; clients: Client[] }) => Promise<T>,
): Promise<T> {
  const schema = `pos_it_${process.pid}_${Math.random().toString(36).slice(2)}`;
  const owner = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
  const clients = Array.from({ length: extraConnections }, () =>
    postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} }),
  );
  try {
    await owner.unsafe(`create schema ${schema}`);
    for (const client of [owner, ...clients]) {
      await client.unsafe(`set search_path to ${schema}, public`);
    }
    await owner.unsafe(DDL);
    return await run({ schema, owner, clients });
  } finally {
    await owner.unsafe(`drop schema if exists ${schema} cascade`);
    await Promise.all([owner, ...clients].map((client) => client.end({ timeout: 5 })));
  }
}

/** Make any UPDATE that would set `fin_products.name` to BOOM_NAME fail. This
 *  is how a "later product write fails after the item write succeeded" is
 *  forced without inventing a fake code path: the shipped statement runs, the
 *  database refuses it, and the surrounding transaction must undo the item
 *  write that already happened inside it. */
const BOOM_NAME = '__forced_product_write_failure__';
async function installProductWriteFailure(owner: Client, schema: string) {
  await owner.unsafe(`
    create function ${schema}.reject_boom() returns trigger language plpgsql as $fn$
    begin
      if new.name = '${BOOM_NAME}' then
        raise exception 'forced fin_products write failure';
      end if;
      return new;
    end
    $fn$;
    create trigger fin_products_reject_boom before update on ${schema}.fin_products
      for each row execute function ${schema}.reject_boom();
  `);
}

const ctxFor = (client: Client) => ({ db: drizzle(client) as never, tenantId: ORG_ID });

/** Await a rejection and hand the reason back. `rejects.toThrow(/…/)` cannot
 *  be used on the forced-failure cases: drizzle wraps the driver error in a
 *  DrizzleQueryError whose own message is the failing SQL, so the PostgreSQL
 *  message lives on the `cause` chain (the same wrapping that broke
 *  `isUniqueViolation`). */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to reject, but it resolved');
}

function messageChain(e: unknown): string {
  const parts: string[] = [];
  for (let cur = e; cur && typeof cur === 'object'; cur = (cur as { cause?: unknown }).cause) {
    parts.push(String((cur as { message?: unknown }).message ?? ''));
  }
  return parts.join(' | ');
}

async function backendPid(client: Client): Promise<number> {
  const [row] = await client.unsafe<{ pid: number }[]>('select pg_backend_pid() as pid');
  return row!.pid;
}

/** Block until every backend in `pids` is actually parked waiting on a lock
 *  (`pg_stat_activity.wait_event_type = 'Lock'`) — not just "the promise has
 *  been fired". Only once BOTH racers are genuinely queued behind the same
 *  held row lock is releasing that lock a real barrier-synchronized start,
 *  rather than a race whose outcome depends on which connection's network
 *  round trip happened to land first. */
async function waitUntilBlocked(owner: Client, pids: number[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await owner.unsafe<{ n: number }[]>(
      `select count(*)::int as n from pg_stat_activity
       where pid in (${pids.join(',')}) and wait_event_type = 'Lock'`,
    );
    if (row!.n === pids.length) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for backends [${pids.join(',')}] to block on the row lock`,
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Strip the values that legitimately differ between two independently
 *  generated rows, so everything else must match exactly. */
function stableRow(row: Record<string, unknown> | undefined, drop: string[]) {
  if (!row) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!drop.includes(k)) out[k] = v;
  return out;
}

describe.runIf(Boolean(databaseUrl))('POS sellable writes against real PostgreSQL', () => {
  it('two concurrent {trackStock:true} PATCHes on the same sellable: exactly one wins, the loser gets item_taken, no partial product write', async () => {
    await withSchema(2, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'CONS', 'Consulta', null, null, true)`,
        [productId, ORG_ID],
      );

      const results = await Promise.allSettled([
        updateSellable(ctxFor(clients[0]!), productId, { trackStock: true }, ACTOR),
        updateSellable(ctxFor(clients[1]!), productId, { trackStock: true }, ACTOR),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = (
        fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof updateSellable>>>
      ).value;
      expect(winner.kind).toBe('product');
      expect(winner.itemId).not.toBeNull();

      const loserReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(loserReason).toBeInstanceOf(PosError);
      expect(loserReason).toMatchObject({ code: 'item_taken' });

      const items = await owner.unsafe<{ id: string }[]>(
        `select id from ${schema}.stk_items where fin_product_id = $1`,
        [productId],
      );
      expect(items).toHaveLength(1);

      const [product] = await owner.unsafe<{ code: string; name: string }[]>(
        `select code, name from ${schema}.fin_products where id = $1`,
        [productId],
      );
      expect(product).toMatchObject({ code: 'CONS', name: 'Consulta' });
    });
  }, 30_000);

  it('ROLLBACK: a forced fin_products failure after the item insert leaves NO stk_items row committed', async () => {
    await withSchema(1, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'CONS', 'Consulta', null, null, true)`,
        [productId, ORG_ID],
      );
      await installProductWriteFailure(owner, schema);

      const failure = await rejectionOf(
        updateSellable(
          ctxFor(clients[0]!),
          productId,
          { kind: 'product', trackStock: true, name: BOOM_NAME },
          ACTOR,
        ),
      );
      expect(messageChain(failure)).toMatch(/forced fin_products write failure/);

      // Read through the independent `owner` connection: if the item insert
      // and the product update had been separate transactions, the item row
      // below would exist and be permanently linked to a product that never
      // took the update.
      const items = await owner.unsafe<{ id: string }[]>(
        `select id from ${schema}.stk_items where org_id = $1`,
        [ORG_ID],
      );
      expect(items).toHaveLength(0);
      const [product] = await owner.unsafe<{ name: string }[]>(
        `select name from ${schema}.fin_products where id = $1`,
        [productId],
      );
      expect(product).toMatchObject({ name: 'Consulta' });
    });
  }, 30_000);

  it('ROLLBACK: a forced fin_products failure after a uom transition leaves the old uom committed', async () => {
    await withSchema(1, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'BTX', 'Botox', null, 250, true)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'BTX', 'Botox', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );
      await installProductWriteFailure(owner, schema);

      const failure = await rejectionOf(
        updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL', name: BOOM_NAME }, ACTOR),
      );
      expect(messageChain(failure)).toMatch(/forced fin_products write failure/);

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      expect(item).toMatchObject({ uom: 'unit' });
      const [product] = await owner.unsafe<{ name: string }[]>(
        `select name from ${schema}.fin_products where id = $1`,
        [productId],
      );
      expect(product).toMatchObject({ name: 'Botox' });
    });
  }, 30_000);

  // The lock-protocol ship gate: applyUomChange's `for('update')` and
  // createEntry's lockItemsAgainstUomChange `for('share')` (see both doc
  // comments in pos.service.ts/stock.service.ts) must serialize a UOM PATCH
  // against a concurrent draft-entry write that would otherwise count as
  // history landing mid-check. A THIRD connection holds the row's lock BEFORE
  // either racer starts and only releases it once both backends are actually
  // parked waiting (`waitUntilBlocked`) — genuine simultaneous contention
  // decided by PostgreSQL's own lock queue, not by which network round trip
  // happens to land first.
  it('LOCK PROTOCOL: a UOM PATCH racing a concurrent draft-entry write on the same item serializes — either the entry lands as history and the UOM change is refused, or the UOM change commits first and the entry commits after it', async () => {
    await withSchema(2, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'RACE', 'Racer', null, 100, true)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'RACE', 'Racer', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );

      const uomPid = await backendPid(clients[0]!);
      const entryPid = await backendPid(clients[1]!);

      await owner.unsafe('begin');
      await owner.unsafe(`select id from ${schema}.stk_items where id = $1 for update`, [itemId]);

      const uomPromise = updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR);
      const entryPromise = createEntry(
        ctxFor(clients[1]!),
        { type: 'receipt', lines: [{ itemId, qty: 5 }] },
        ACTOR,
      );

      await waitUntilBlocked(owner, [uomPid, entryPid]);
      await owner.unsafe('commit');

      const [uomResult, entryResult] = await Promise.allSettled([uomPromise, entryPromise]);

      // The draft-entry writer is never the party this protocol refuses — it
      // only ever serializes around the UOM change, so it must always succeed.
      expect(entryResult.status).toBe('fulfilled');

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      const lines = await owner.unsafe<{ id: string }[]>(
        `select id from ${schema}.stk_entry_lines where item_id = $1`,
        [itemId],
      );
      expect(lines).toHaveLength(1);

      if (uomResult.status === 'fulfilled') {
        // The UOM change won the lock race and committed before the entry's
        // line could land — no history existed yet to reinterpret.
        expect(item).toMatchObject({ uom: 'mL' });
      } else {
        // The entry's draft line won the lock race, committed first, and now
        // counts as history — the UOM change must have been refused, and the
        // pre-race uom must still stand, exactly as if it had run strictly
        // after the entry rather than concurrently with it.
        expect(uomResult.reason).toBeInstanceOf(PosError);
        expect(uomResult.reason).toMatchObject({ code: 'uom_immutable' });
        expect(item).toMatchObject({ uom: 'unit' });
      }
    });
  }, 30_000);

  // Same lock-protocol proof as above, but through the sourced-issue draft
  // writer (createSourcedIssue → insertSourcedIssueEntry → the shared
  // resolveConsumptionLines): stock.service.ts's `resolveConsumptionLines`
  // must take the same lockItemsAgainstUomChange lock BEFORE deriving/writing
  // its stk_entry_lines row, or a concurrent UOM PATCH could check "no
  // history", rename the uom, and let this writer's draft land under the OLD
  // conversion factor undetected.
  it('LOCK PROTOCOL: a UOM PATCH racing a concurrent sourced-issue draft write on the same item serializes', async () => {
    await withSchema(2, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const warehouseId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'SRC', 'Sourced', null, 100, true)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'SRC', 'Sourced', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );
      await owner.unsafe(`insert into stk_warehouses (id, org_id, name) values ($1, $2, 'Main')`, [
        warehouseId,
        ORG_ID,
      ]);

      const uomPid = await backendPid(clients[0]!);
      const issuePid = await backendPid(clients[1]!);

      await owner.unsafe('begin');
      await owner.unsafe(`select id from ${schema}.stk_items where id = $1 for update`, [itemId]);

      const uomPromise = updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR);
      const issuePromise = createSourcedIssue(ctxFor(clients[1]!), {
        source: 'pos',
        sourceId: 'src-race-1',
        warehouseId,
        lines: [{ itemId, qty: 5 }],
        actor: ACTOR,
      });

      await waitUntilBlocked(owner, [uomPid, issuePid]);
      await owner.unsafe('commit');

      const [uomResult, issueResult] = await Promise.allSettled([uomPromise, issuePromise]);

      // The sourced-issue writer is never the party this protocol refuses —
      // it only ever serializes around the UOM change, so it must succeed.
      expect(issueResult.status).toBe('fulfilled');

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      const lines = await owner.unsafe<{ id: string }[]>(
        `select id from ${schema}.stk_entry_lines where item_id = $1`,
        [itemId],
      );
      expect(lines).toHaveLength(1);

      if (uomResult.status === 'fulfilled') {
        expect(item).toMatchObject({ uom: 'mL' });
      } else {
        expect(uomResult.reason).toBeInstanceOf(PosError);
        expect(uomResult.reason).toMatchObject({ code: 'uom_immutable' });
        expect(item).toMatchObject({ uom: 'unit' });
      }
    });
  }, 30_000);

  // Same proof again through the invoice-issue draft writer
  // (createIssueFromInvoice), the second unguarded call site the same
  // `resolveConsumptionLines` fix closes.
  it('LOCK PROTOCOL: a UOM PATCH racing a concurrent invoice-issue draft write on the same item serializes', async () => {
    await withSchema(2, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const warehouseId = crypto.randomUUID();
      const invoiceId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'INV', 'Invoiced', null, 100, true)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'INV', 'Invoiced', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );
      await owner.unsafe(`insert into stk_warehouses (id, org_id, name) values ($1, $2, 'Main')`, [
        warehouseId,
        ORG_ID,
      ]);
      await owner.unsafe(
        `insert into fin_invoices (id, org_id, provider, provider_ref) values ($1, $2, 'susii', 'REF-1')`,
        [invoiceId, ORG_ID],
      );

      const uomPid = await backendPid(clients[0]!);
      const issuePid = await backendPid(clients[1]!);

      await owner.unsafe('begin');
      await owner.unsafe(`select id from ${schema}.stk_items where id = $1 for update`, [itemId]);

      const uomPromise = updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR);
      const issuePromise = createIssueFromInvoice(ctxFor(clients[1]!), {
        invoiceId,
        warehouseId,
        lines: [{ itemId, qty: 5 }],
        actor: ACTOR,
      });

      await waitUntilBlocked(owner, [uomPid, issuePid]);
      await owner.unsafe('commit');

      const [uomResult, issueResult] = await Promise.allSettled([uomPromise, issuePromise]);

      expect(issueResult.status).toBe('fulfilled');

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      const lines = await owner.unsafe<{ id: string }[]>(
        `select id from ${schema}.stk_entry_lines where item_id = $1`,
        [itemId],
      );
      expect(lines).toHaveLength(1);

      if (uomResult.status === 'fulfilled') {
        expect(item).toMatchObject({ uom: 'mL' });
      } else {
        expect(uomResult.reason).toBeInstanceOf(PosError);
        expect(uomResult.reason).toMatchObject({ code: 'uom_immutable' });
        expect(item).toMatchObject({ uom: 'unit' });
      }
    });
  }, 30_000);

  it('LOCK PROTOCOL: invoice upsert with an empty stale product map resolves the current code and serializes with a UOM PATCH', async () => {
    await withSchema(2, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name) values ($1, $2, 'LIVE', 'Live')`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'LIVE', 'Live', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );

      const uomPid = await backendPid(clients[0]!);
      const invoicePid = await backendPid(clients[1]!);
      await owner.unsafe('begin');
      await owner.unsafe(`select id from ${schema}.stk_items where id = $1 for update`, [itemId]);

      const uomPromise = updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR);
      const invoicePromise = upsertInvoicesBatch(
        ctxFor(clients[1]!),
        [
          {
            provider: 'test',
            providerRef: 'invoice-race',
            number: null,
            documentId: null,
            issuedAt: null,
            clientName: null,
            clientDocType: null,
            clientDocNumber: null,
            clientEmail: null,
            currency: 'PEN',
            subtotal: 1,
            tax: 0,
            discount: 0,
            total: 1,
            status: 'paid',
            seller: null,
            note: null,
            metadata: {},
            items: [
              {
                code: 'LIVE',
                description: 'Live',
                category: null,
                quantity: 1,
                unitPrice: 1,
                discount: 0,
                tax: 0,
                total: 1,
                metadata: {},
              },
            ],
            payments: [],
            client: null,
          },
        ],
        new Map(),
      );

      await waitUntilBlocked(owner, [uomPid, invoicePid]);
      await owner.unsafe('commit');
      const [uomResult, invoiceResult] = await Promise.allSettled([uomPromise, invoicePromise]);

      expect(invoiceResult.status).toBe('fulfilled');
      const [line] = await owner.unsafe<{ product_id: string }[]>(
        `select product_id from ${schema}.fin_invoice_items where code = 'LIVE'`,
      );
      expect(line).toMatchObject({ product_id: productId });
      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      if (uomResult.status === 'fulfilled') {
        expect(item).toMatchObject({ uom: 'mL' });
      } else {
        expect(uomResult.reason).toBeInstanceOf(PosError);
        expect(uomResult.reason).toMatchObject({ code: 'uom_immutable' });
        expect(item).toMatchObject({ uom: 'unit' });
      }
    });
  }, 30_000);

  it('ALIAS HISTORY: an invoice line coded with a RETIRED alias but linked by product_id blocks the uom change', async () => {
    await withSchema(1, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      // Exactly the shape finance.service.ts's loadProductMap/upsertInvoicesBatch
      // produce: the live code moved to NEW, OLD survives in metadata.aliases,
      // and the synced line keeps the incoming alias in `code` while `product_id`
      // resolves to this product.
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, unit_price, active, metadata)
         values ($1, $2, 'NEW', 'Botox', 250, true, '{"aliases":["OLD"]}'::jsonb)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'NEW', 'Botox', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );
      await owner.unsafe(
        `insert into fin_invoice_items (org_id, product_id, code, description, quantity, total)
         values ($1, $2, 'OLD', 'Botox 100U', 1, 250)`,
        [ORG_ID, productId],
      );

      await expect(
        updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR),
      ).rejects.toMatchObject({ code: 'uom_immutable' });

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      expect(item).toMatchObject({ uom: 'unit' });
    });
  }, 30_000);

  it('ALIAS HISTORY: a legacy invoice line with a NULL product_id still blocks via the code fallback', async () => {
    await withSchema(1, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, unit_price, active)
         values ($1, $2, 'LEGA', 'Legacy', 100, true)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'LEGA', 'Legacy', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );
      await owner.unsafe(
        `insert into fin_invoice_items (org_id, product_id, code, description, quantity, total)
         values ($1, null, 'LEGA', 'Legacy line', 1, 100)`,
        [ORG_ID],
      );

      await expect(
        updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR),
      ).rejects.toMatchObject({ code: 'uom_immutable' });

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      expect(item).toMatchObject({ uom: 'unit' });
    });
  }, 30_000);

  it('ALIAS HISTORY control: a genuinely pristine item still accepts the uom change', async () => {
    await withSchema(1, async ({ schema, owner, clients }) => {
      const productId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, unit_price, active, metadata)
         values ($1, $2, 'FRSH', 'Fresh', 10, true, '{"aliases":["GONE"]}'::jsonb)`,
        [productId, ORG_ID],
      );
      await owner.unsafe(
        `insert into stk_items (id, org_id, code, name, uom, fin_product_id)
         values ($1, $2, 'FRSH', 'Fresh', 'unit', $3)`,
        [itemId, ORG_ID, productId],
      );

      const row = await updateSellable(ctxFor(clients[0]!), productId, { uom: 'mL' }, ACTOR);
      expect(row.itemId).toBe(itemId);

      const [item] = await owner.unsafe<{ uom: string }[]>(
        `select uom from ${schema}.stk_items where id = $1`,
        [itemId],
      );
      expect(item).toMatchObject({ uom: 'mL' });
    });
  }, 30_000);

  // The behavioural-parity ship gate: not "both workflows called the same
  // helper with the same arguments" (that is a mock mirror — it survives any
  // divergence introduced by transaction boundaries, database defaults,
  // constraints or projection drift) but "both workflows leave the database
  // in the same state and hand back the same row". Both runs use the SAME
  // code/name in the same schema — the first workflow's rows are removed
  // before the second runs — so only generated ids and timestamps are
  // excluded from the comparison.
  for (const uom of [undefined, 'mL'] as const) {
    it(`PARITY: createSellable(trackStock) and createSellable(service)+updateSellable(trackStock) persist identical rows — uom ${uom ?? 'omitted'}`, async () => {
      await withSchema(1, async ({ schema, owner, clients }) => {
        const ctx = ctxFor(clients[0]!);
        const base = {
          name: 'Botox 100U',
          code: 'BTX',
          category: 'inyectables',
          unitPrice: 250,
        };

        const snapshot = async () => {
          const [product] = await owner.unsafe<Record<string, unknown>[]>(
            `select * from ${schema}.fin_products where org_id = $1`,
            [ORG_ID],
          );
          const [item] = await owner.unsafe<Record<string, unknown>[]>(
            `select * from ${schema}.stk_items where org_id = $1`,
            [ORG_ID],
          );
          return {
            product: stableRow(product, ['id', 'sku', 'created_at', 'updated_at']),
            item: stableRow(item, ['id', 'sku', 'fin_product_id', 'created_at', 'updated_at']),
          };
        };

        const directRow = await createSellable(
          ctx,
          { ...base, kind: 'product', trackStock: true, ...(uom ? { uom } : {}) },
          ACTOR,
        );
        const directState = await snapshot();

        // Clear the schema so the staged workflow can reuse the same code —
        // then code, name and the derived taxonomy are all part of the
        // comparison rather than excluded as "expected to differ".
        await owner.unsafe(`delete from ${schema}.stk_items`);
        await owner.unsafe(`delete from ${schema}.fin_products`);

        const staged0 = await createSellable(ctx, { ...base, kind: 'service' }, ACTOR);
        const stagedRow = await updateSellable(
          ctx,
          staged0.productId,
          { kind: 'product', trackStock: true, ...(uom ? { uom } : {}) },
          ACTOR,
        );
        const stagedState = await snapshot();

        expect(stagedState.product).toEqual(directState.product);
        expect(stagedState.item).toEqual(directState.item);
        expect(directState.item).toMatchObject({ uom: uom ?? 'unit' });

        expect(
          stableRow(stagedRow as unknown as Record<string, unknown>, ['productId', 'itemId']),
        ).toEqual(
          stableRow(directRow as unknown as Record<string, unknown>, ['productId', 'itemId']),
        );
        expect(stagedRow.kind).toBe('product');
        expect(stagedRow.itemId).not.toBeNull();
      });
    }, 30_000);
  }
});
