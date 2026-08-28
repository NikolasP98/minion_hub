import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { describe, expect, it, vi } from 'vitest';

/**
 * PR #142/#149 (the same spec, twice) both failed on this exact gap: the
 * "concurrent double-PATCH" test only ever made ONE call to updateSellable
 * with a mock preconfigured to throw 23505 — it never raced two real
 * transitions against a real unique index. This file is the transaction-
 * faithful proof: two genuinely concurrent PostgreSQL connections both PATCH
 * {trackStock:true} on the SAME sellable; `stk_items_org_fin_product_uniq`
 * (companion migration 20260719230000_stk_items_fin_product_uniq.sql) must
 * let exactly one land and surface the loser as 'item_taken' with no partial
 * fin_products write from the loser (syncSellableItem runs before the
 * fin_products update in updateSellable, so a loser never reaches it).
 *
 * `withOrgCore` is mocked to hand back `scope.db` directly instead of opening
 * its own transaction/RLS GUC — the two ctx objects below carry TWO distinct
 * real `postgres`/drizzle connections, so the race is genuine network-level
 * concurrency, not two calls serialized through one connection. Correctness
 * here rests on the real partial unique index, not on the RLS/GUC machinery
 * withOrgCore normally sets up, so skipping it is safe for this suite's claim.
 *
 * fin_products/stk_items/stk_bins/stk_consumption/fin_product_components all
 * have in-repo CREATE TABLE migrations (unlike organizations/crm_activities —
 * see hub-supabase-schema-not-reproducible.md), so this runs against the bare
 * `postgres:15` CI service, no full-schema database required.
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
  withOrgCore: async (scope: { db: unknown }, fn: (tx: unknown) => unknown) => fn(scope.db),
}));

const { updateSellable, PosError } = await import('./pos.service');

describe.runIf(Boolean(databaseUrl))('updateSellable trackStock transition against PostgreSQL', () => {
  it('two concurrent {trackStock:true} PATCHes on the same sellable: exactly one wins, the loser gets item_taken, no partial product write', async () => {
    const schema = `pos_trackstock_${process.pid}_${Math.random().toString(36).slice(2)}`;
    const owner = postgres(databaseUrl!, { max: 1, prepare: false });
    const client1 = postgres(databaseUrl!, { max: 1, prepare: false });
    const client2 = postgres(databaseUrl!, { max: 1, prepare: false });
    const orgId = 'org-race';
    const productId = crypto.randomUUID();

    try {
      await owner.unsafe(`create schema ${schema}`);
      for (const client of [owner, client1, client2]) {
        await client.unsafe(`set search_path to ${schema}, public`);
      }
      await owner.unsafe(`
        create table fin_products (
          id uuid primary key,
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
          item_id uuid not null,
          warehouse_id uuid not null,
          qty numeric not null default 0,
          valuation_rate numeric not null default 0,
          updated_at timestamptz not null default now(),
          primary key (org_id, item_id, warehouse_id)
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
      `);
      await owner.unsafe(
        `insert into fin_products (id, org_id, code, name, category, unit_price, active)
         values ($1, $2, 'CONS', 'Consulta', null, null, true)`,
        [productId, orgId],
      );

      const actor = { id: 'u1', name: 'Race Tester' };
      const ctx1 = { db: drizzle(client1) as never, tenantId: orgId };
      const ctx2 = { db: drizzle(client2) as never, tenantId: orgId };

      const results = await Promise.allSettled([
        updateSellable(ctx1, productId, { trackStock: true }, actor),
        updateSellable(ctx2, productId, { trackStock: true }, actor),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winner = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof updateSellable>>>)
        .value;
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
    } finally {
      await owner.unsafe(`drop schema if exists ${schema} cascade`);
      await Promise.all([
        owner.end({ timeout: 5 }),
        client1.end({ timeout: 5 }),
        client2.end({ timeout: 5 }),
      ]);
    }
  }, 30_000);
});
