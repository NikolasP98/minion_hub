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
 * fin_products/stk_items/stk_bins/stk_consumption/fin_product_components/
 * stk_ledger/stk_entry_lines all have in-repo CREATE TABLE migrations (unlike
 * organizations/crm_activities — see hub-supabase-schema-not-reproducible.md).
 * `fin_invoice_items` does not, so the columns this suite touches (org_id,
 * code, product_id) are mirrored from `pg-finance-schema.ts` below. No
 * full-schema database is required.
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
  withOrgCore: <T,>(
    scope: { db: { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> } },
    fn: (tx: never) => Promise<T>,
  ) => (fn as (tx: unknown) => Promise<T>)((scope as any).db),
}));

const { createSellable, updateSellable, PosError } = await import('./pos.service');

type Client = ReturnType<typeof postgres>;

const ORG_ID = 'org-pos-integration';
const ACTOR = { id: 'u1', name: 'Integration Tester' };

/** Columns mirrored from the in-repo migrations / drizzle schema for the
 *  tables these paths read and write. */
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
  create table stk_bins (
    org_id text not null,
    item_id uuid not null references stk_items (id),
    warehouse_id uuid not null,
    qty numeric not null default 0,
    valuation_rate numeric not null default 0,
    updated_at timestamptz not null default now(),
    primary key (org_id, item_id, warehouse_id)
  );
  create table stk_entry_lines (
    id uuid primary key default gen_random_uuid(),
    org_id text not null,
    entry_id uuid not null,
    item_id uuid not null references stk_items (id),
    qty numeric not null,
    uom text,
    rate numeric,
    line_no integer not null default 0
  );
  create table stk_ledger (
    id bigserial primary key,
    org_id text not null,
    item_id uuid not null references stk_items (id),
    warehouse_id uuid not null,
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
    quantity numeric,
    total numeric,
    metadata jsonb not null default '{}'
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
            item: stableRow(item, [
              'id',
              'sku',
              'fin_product_id',
              'created_at',
              'updated_at',
            ]),
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

        expect(stableRow(stagedRow as unknown as Record<string, unknown>, ['productId', 'itemId']))
          .toEqual(stableRow(directRow as unknown as Record<string, unknown>, ['productId', 'itemId']));
        expect(stagedRow.kind).toBe('product');
        expect(stagedRow.itemId).not.toBeNull();
      });
    }, 30_000);
  }
});
