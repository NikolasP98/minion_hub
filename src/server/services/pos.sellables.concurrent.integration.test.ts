import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { createSellable, updateSellable } from './pos.service';

/**
 * `updateSellable`'s Slice-1 transition (an untracked service starts tracking
 * stock) against a REAL PostgreSQL server.
 *
 * Why this file exists. `pos.sellables.test.ts` mocks `createItemTx` and the db
 * handle, so it can prove the DECISIONS the service makes — which guard fires,
 * which payload is built, that both writes share one transaction handle — but
 * it cannot prove either property the spec actually rests on:
 *
 *   1. that `stk_items_org_fin_product_uniq` admits exactly ONE linked item
 *      when two false→true updates run at the same time, and
 *   2. that a `fin_products_org_code_uniq` violation on the SAME request rolls
 *      the item insert back.
 *
 * Both are PostgreSQL's behaviour, not the service's, and a mock that is told
 * to raise `23505` proves only the translation of that error. Everything here
 * therefore runs the SHIPPED `createSellable` / `updateSellable` through the
 * real `withOrgCore()` (SET LOCAL ROLE app_ledger + `app.current_org_id` GUC)
 * on real connections, and asserts on rows read back from the database.
 *
 * Schema. `fin_products` has no `create table` anywhere in this repository (the
 * `hub-supabase-schema-not-reproducible` operator note), so CI supplies the
 * subset this file touches from a CI-ONLY fixture rather than a migration:
 * `supabase/ci-fixtures/pos-sellable-transition.sql`, applied by the
 * `pos-sellable-transition-postgres` job in `.github/workflows/ci.yml` to a
 * bare `postgres:15` service container. That fixture's header records, per
 * table, whether its shape is copied from a checked-in migration or
 * reconstructed from the Drizzle model.
 *
 * Locally it skips unless `SUPABASE_DB_URL` is set — point it at a container
 * seeded with that same fixture.
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

// Same loud-skip convention as the CRM concurrency suite: when a caller
// PROMISES a database, an empty URL is a misconfigured job, not a quiet pass.
if (process.env.REQUIRE_POS_SELLABLE_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_POS_SELLABLE_POSTGRES is set but SUPABASE_DB_URL is empty — this suite needs a ' +
      'database carrying fin_products + stk_items under the org-GUC RLS policies. The ' +
      'pos-sellable-transition-postgres CI job seeds exactly that into its postgres service ' +
      'from supabase/ci-fixtures/pos-sellable-transition.sql; locally, point SUPABASE_DB_URL ' +
      'at a container seeded with that same fixture.',
  );
}

const actor = { id: null, name: null };

/** A `CoreCtx` on its OWN physical connection — two of these are two genuinely
 *  concurrent database sessions, which is the whole point of this file. */
function appCtx(client: postgres.Sql, orgId: string) {
  return { db: drizzle(client) as never, tenantId: orgId };
}

/**
 * Block until `n` backends in this database are waiting on a lock.
 *
 * The barrier that makes the race deterministic. Polling `pg_stat_activity`
 * rather than sleeping means the test advances exactly when the contended
 * state it needs has actually been reached, so a slow CI runner makes it
 * slower, never flaky.
 */
async function waitForLockWaiters(owner: postgres.Sql, n: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const [row] = await owner<{ waiting: number }[]>`
      select count(*)::int as waiting
      from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and wait_event_type = 'Lock'
    `;
    if ((row?.waiting ?? 0) >= n) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${n} lock waiter(s); saw ${row?.waiting ?? 0}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Seed an untracked service directly, so the arrange step cannot depend on the
 *  code path under test. Returns the new product id. */
async function seedService(
  owner: postgres.Sql,
  orgId: string,
  code: string,
  name: string,
): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    insert into fin_products (org_id, code, name, active)
    values (${orgId}, ${code}, ${name}, true)
    returning id::text
  `;
  return row.id;
}

/** Every stk_items row linked to `productId`, read over the owner connection —
 *  the readback is deliberately NOT the projection the service returns. */
function linkedItems(owner: postgres.Sql, productId: string) {
  return owner<{ id: string; code: string; name: string; uom: string }[]>`
    select id::text, code, name, uom
    from stk_items
    where fin_product_id = ${productId}
    order by created_at
  `;
}

/**
 * Run two `updateSellable` calls into a genuine collision and settle both.
 *
 * The barrier: an owner transaction pins the `fin_products` row, so call A
 * parks on its `update fin_products` AFTER it has already issued (but not
 * committed) its `stk_items` insert. B then reads "untracked" — A's insert is
 * invisible to it — and blocks on A's uncommitted row when it inserts its own.
 * Releasing the pin lets A commit, at which point B's insert is rejected. That
 * is exactly the interleaving the unique indexes exist to survive, and it is
 * reached by waiting for the contended state rather than by sleeping.
 */
async function raceTwoTransitions(
  owner: postgres.Sql,
  a: { client: postgres.Sql; patch: Record<string, unknown> },
  b: { client: postgres.Sql; patch: Record<string, unknown> },
  orgId: string,
  productId: string,
) {
  let pinReady!: () => void;
  const pinned = new Promise<void>((resolve) => (pinReady = resolve));
  let releasePin!: () => void;
  const releaseRequested = new Promise<void>((resolve) => (releasePin = resolve));

  const pin = owner.begin(async (tx) => {
    await tx`select id from fin_products where id = ${productId} for update`;
    pinReady();
    await releaseRequested;
  });
  await pinned;

  const first = updateSellable(appCtx(a.client, orgId), productId, a.patch, actor);
  // 1 waiter = A, blocked on the pinned row with its item insert already issued.
  await waitForLockWaiters(owner, 1);

  const second = updateSellable(appCtx(b.client, orgId), productId, b.patch, actor);
  // 2 waiters = B is now blocked on A's uncommitted stk_items row — i.e. it
  // read "untracked" and reached its own insert.
  await waitForLockWaiters(owner, 2);

  releasePin();
  await pin;
  return Promise.allSettled([first, second]);
}

describe.runIf(Boolean(databaseUrl))(
  'updateSellable trackStock false→true against real PostgreSQL',
  () => {
    it('two concurrent identical false→true updates leave EXACTLY ONE linked item; the loser gets item_taken', async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 2, prepare: false });
      const first = postgres(databaseUrl!, { max: 1, prepare: false });
      const second = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const productId = await seedService(owner, orgId, 'CONS', 'Consulta');

        // The operator double-click: the same PATCH twice. Both requests derive
        // the item code from the sellable's own code, so `stk_items_org_code_uniq`
        // is what rejects the loser here.
        const [winnerResult, loserResult] = await raceTwoTransitions(
          owner,
          { client: first, patch: { trackStock: true, uom: 'Unidad' } },
          { client: second, patch: { trackStock: true, uom: 'Caja' } },
          orgId,
          productId,
        );

        expect(winnerResult.status).toBe('fulfilled');
        expect(winnerResult.status === 'fulfilled' && winnerResult.value).toMatchObject({
          kind: 'product',
          trackStock: true,
          uom: 'Unidad',
        });
        expect(loserResult.status).toBe('rejected');
        expect(loserResult.status === 'rejected' && loserResult.reason).toMatchObject({
          code: 'item_taken',
        });

        // The durable fact, read straight from the table: one link, and it is
        // the winner's — the loser's 'Caja' never reached storage.
        const items = await linkedItems(owner, productId);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ code: 'CONS', name: 'Consulta', uom: 'Unidad' });
      } finally {
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([
          owner.end({ timeout: 5 }),
          first.end({ timeout: 5 }),
          second.end({ timeout: 5 }),
        ]);
      }
    }, 45_000);

    it('stk_items_org_fin_product_uniq admits ONE link even when the two racing items have DIFFERENT codes', async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 2, prepare: false });
      const first = postgres(databaseUrl!, { max: 1, prepare: false });
      const second = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const productId = await seedService(owner, orgId, 'CONS', 'Consulta');

        // The loser renames the sellable in the same request, so its item is
        // built with code 'ALT'. `stk_items_org_code_uniq` therefore does NOT
        // apply, and the only thing standing between this race and two items
        // linked to one product is the PARTIAL index on (org_id,
        // fin_product_id) — the invariant the spec's Slice-1 stop-condition
        // names. This case is why reading the migration is not evidence.
        const [winnerResult, loserResult] = await raceTwoTransitions(
          owner,
          { client: first, patch: { trackStock: true, uom: 'Unidad' } },
          { client: second, patch: { trackStock: true, uom: 'Caja', code: 'ALT' } },
          orgId,
          productId,
        );

        expect(winnerResult.status).toBe('fulfilled');
        expect(loserResult.status).toBe('rejected');
        expect(loserResult.status === 'rejected' && loserResult.reason).toMatchObject({
          code: 'item_taken',
        });

        const items = await linkedItems(owner, productId);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ code: 'CONS', uom: 'Unidad' });

        // The loser's rename rolled back with its insert: the sellable is still
        // 'CONS', so nothing of the failed request survived.
        const [product] = await owner<{ code: string }[]>`
          select code from fin_products where id = ${productId}
        `;
        expect(product.code).toBe('CONS');
      } finally {
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([
          owner.end({ timeout: 5 }),
          first.end({ timeout: 5 }),
          second.end({ timeout: 5 }),
        ]);
      }
    }, 45_000);

    it('a code collision on the SAME request reports code_taken and rolls the stock link back', async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const app = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const productId = await seedService(owner, orgId, 'CONS', 'Consulta');
        // 'TAKE', not 'TAKEN': `normalizeCode` caps a catalog code at 4 chars,
        // so a 5-char patch would not collide at all and the case would pass
        // vacuously.
        await seedService(owner, orgId, 'TAKE', 'Otro');

        // Start tracking AND rename onto a code another product already holds.
        // The item insert is issued first and succeeds; the rename then trips
        // fin_products_org_code_uniq. Sharing one transaction is what makes the
        // insert disappear with it.
        await expect(
          updateSellable(
            appCtx(app, orgId),
            productId,
            { trackStock: true, uom: 'Unidad', code: 'TAKE' },
            actor,
          ),
        ).rejects.toMatchObject({ code: 'code_taken' });

        expect(await linkedItems(owner, productId)).toHaveLength(0);
        // …and no orphan under the sellable's own code either: the rollback is
        // total, not merely "no link column set".
        const [{ n }] = await owner<{ n: number }[]>`
          select count(*)::int as n from stk_items where org_id = ${orgId}
        `;
        expect(n).toBe(0);

        // The product is untouched — a failed PATCH leaves no partial mutation.
        const [product] = await owner<{ code: string; name: string }[]>`
          select code, name from fin_products where id = ${productId}
        `;
        expect(product).toEqual({ code: 'CONS', name: 'Consulta' });
      } finally {
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([owner.end({ timeout: 5 }), app.end({ timeout: 5 })]);
      }
    }, 45_000);

    it('an invalid later consumption row leaves the product, stock link, and prior replace-set unchanged', async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const app = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const productId = await seedService(owner, orgId, 'CONS', 'Consulta');
        const [firstItem, secondItem] = await owner<{ id: string }[]>`
          insert into stk_items (org_id, code, name, uom)
          values (${orgId}, 'MAT1', 'Material 1', 'unit'),
                 (${orgId}, 'MAT2', 'Material 2', 'unit')
          returning id::text
        `;
        await owner`
          insert into stk_consumption (org_id, fin_product_id, item_id, qty_per_unit, note)
          values (${orgId}, ${productId}, ${firstItem.id}, 2, 'original')
        `;

        await expect(
          updateSellable(
            appCtx(app, orgId),
            productId,
            {
              name: 'Changed name',
              trackStock: true,
              uom: 'Unidad',
              consumption: [
                { itemId: firstItem.id, qtyPerUnit: 7, note: 'changed' },
                { itemId: secondItem.id, qtyPerUnit: 0 },
              ],
            },
            actor,
          ),
        ).rejects.toMatchObject({ code: 'invalid_consumption' });

        const [product] = await owner<{ name: string }[]>`
          select name from fin_products where id = ${productId}
        `;
        expect(product.name).toBe('Consulta');
        expect(await linkedItems(owner, productId)).toHaveLength(0);
        const mappings = await owner<{ itemId: string; qty: number; note: string | null }[]>`
          select item_id::text as "itemId", qty_per_unit::float8 as qty, note
          from stk_consumption where org_id = ${orgId} and fin_product_id = ${productId}
        `;
        expect(mappings).toEqual([{ itemId: firstItem.id, qty: 2, note: 'original' }]);
      } finally {
        await owner`delete from stk_consumption where org_id = ${orgId}`;
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([owner.end({ timeout: 5 }), app.end({ timeout: 5 })]);
      }
    }, 45_000);

    it('PARITY: create(tracked) and create(service)+update(trackStock) STORE the same item shape', async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const app = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const ctx = appCtx(app, orgId);

        // Path A — tracked from the start.
        const viaCreate = await createSellable(
          ctx,
          {
            name: 'Consulta',
            code: 'CONA',
            unitPrice: null,
            kind: 'product',
            trackStock: true,
            uom: 'Unidad',
          },
          actor,
        );

        // Path B — created as a service, then switched on.
        const serviceRow = await createSellable(
          ctx,
          { name: 'Consulta', code: 'CONB', unitPrice: null, kind: 'service' },
          actor,
        );
        const viaUpdate = await updateSellable(
          ctx,
          serviceRow.productId,
          { trackStock: true, uom: 'Unidad' },
          actor,
        );

        // Not a mock echo: two different functions built these rows, and the
        // comparison is on what PostgreSQL actually holds.
        const [a] = await linkedItems(owner, viaCreate.productId);
        const [b] = await linkedItems(owner, viaUpdate.productId);
        expect(a).toMatchObject({ code: 'CONA', name: 'Consulta', uom: 'Unidad' });
        // Everything the item-sync path owns, minus the identity fields that
        // are per-sellable by construction.
        expect({ ...b, id: undefined, code: undefined }).toEqual({
          ...a,
          id: undefined,
          code: undefined,
        });
        expect(b.code).toBe('CONB');

        // The projection both callers read back agrees with storage.
        expect(viaUpdate).toMatchObject({ kind: 'product', trackStock: true, uom: 'Unidad' });
        expect(viaCreate).toMatchObject({ kind: 'product', trackStock: true, uom: 'Unidad' });
      } finally {
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([owner.end({ timeout: 5 }), app.end({ timeout: 5 })]);
      }
    }, 45_000);

    it("a whitespace-only uom is stored as the 'unit' default, not as blank", async () => {
      const orgId = crypto.randomUUID();
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const app = postgres(databaseUrl!, { max: 1, prepare: false });

      try {
        const productId = await seedService(owner, orgId, 'CONS', 'Consulta');

        // The HTTP schemas refuse this outright (`z.string().trim().min(1)`);
        // the gateway POS tools call the service directly, so the service's own
        // normalisation is what stands between "   " and the stored unit.
        const row = await updateSellable(
          appCtx(app, orgId),
          productId,
          { trackStock: true, uom: '   ' },
          actor,
        );

        const items = await linkedItems(owner, productId);
        expect(items).toHaveLength(1);
        expect(items[0].uom).toBe('unit');
        expect(row.uom).toBe('unit');
      } finally {
        await owner`delete from stk_items where org_id = ${orgId}`;
        await owner`delete from fin_products where org_id = ${orgId}`;
        await Promise.all([owner.end({ timeout: 5 }), app.end({ timeout: 5 })]);
      }
    }, 45_000);
  },
);
