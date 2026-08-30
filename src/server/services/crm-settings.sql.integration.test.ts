import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { depositWriteSchema } from './crm-deposit-rule';

/**
 * Real-PostgreSQL proof for `writeDepositRule`'s sibling-key-preserving merge
 * — the S3 ship gate `crm-settings.service.test.ts` only covers with a mocked
 * query-shape assertion (checks the generated SQL text CONTAINS `||` and
 * `jsonb_build_object('deposit'`, never executes it). That proves the SQL was
 * ASSEMBLED with the right shape, not that PostgreSQL actually merges rather
 * than replaces: malformed SQL, wrong conflict-target behavior, or an adapter
 * that silently drops the merge could all still pass a query-shape check.
 *
 * This suite seeds a `crm_settings` row with a sibling key another feature
 * owns (`disabled_channels`), calls the shipped `writeDepositRule`, and reads
 * the row back through an INDEPENDENT connection — the sibling key,
 * server-stamped `updatedAt`, and an immediate `resolveDepositRule` read must
 * all agree with what actually landed in the database.
 *
 * ★ `withOrgCore` is replaced with a TRANSACTION-FAITHFUL adapter
 * (`scope.db.transaction(fn)`), matching pos.trackstock.concurrent.integration.test.ts —
 * see that file's doc comment for why a bare pass-through (autocommit) adapter
 * is the wrong mock even when no test here forces a rollback.
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

if (process.env.REQUIRE_CRM_SETTINGS_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_SETTINGS_POSTGRES is set but SUPABASE_DB_URL is empty — this suite needs a ' +
      'real PostgreSQL connection to prove the deposit-rule merge preserves sibling keys.',
  );
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: <T>(
    scope: { db: { transaction: (fn: (tx: unknown) => Promise<T>) => Promise<T> } },
    fn: (tx: never) => Promise<T>,
  ) => scope.db.transaction((tx) => (fn as (tx: unknown) => Promise<T>)(tx)),
}));

const { writeDepositRule, resolveDepositRule } = await import('./crm-settings.service');
const { deleteMissingWinEmbeddings } = await import('./crm-similarity.service');

type Client = ReturnType<typeof postgres>;

const ORG_ID = 'org-crm-settings-integration';

const DDL = `
  create table crm_settings (
    org_id text primary key,
    value jsonb not null default '{}',
    updated_at timestamptz not null default now()
  );
  create table crm_win_embeddings (
    org_id text not null,
    contact_id uuid not null,
    msg_count integer not null default 0,
    bought text[] not null default '{}',
    snippet text,
    built_at timestamptz not null default now(),
    primary key (org_id, contact_id)
  );
`;

/** One throwaway schema per test; `owner` is the independent connection every
 *  assertion reads persisted state through, `client` is the one the shipped
 *  service call runs on. */
async function withSchema<T>(
  run: (env: { schema: string; owner: Client; client: Client }) => Promise<T>,
): Promise<T> {
  const schema = `crm_settings_it_${process.pid}_${Math.random().toString(36).slice(2)}`;
  const owner = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
  const client = postgres(databaseUrl!, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await owner.unsafe(`create schema ${schema}`);
    for (const c of [owner, client]) {
      await c.unsafe(`set search_path to ${schema}, public`);
    }
    await owner.unsafe(DDL);
    return await run({ schema, owner, client });
  } finally {
    await owner.unsafe(`drop schema if exists ${schema} cascade`);
    await Promise.all([owner, client].map((c) => c.end({ timeout: 5 })));
  }
}

const ctxFor = (client: Client) => ({ db: drizzle(client) as never, tenantId: ORG_ID });

describe.runIf(Boolean(databaseUrl))('writeDepositRule against real PostgreSQL', () => {
  it('merges the deposit key without disturbing a sibling key, stamps updatedAt server-side, and resolveDepositRule agrees immediately', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      // postgres.js's `.unsafe()` double-encodes a pre-`JSON.stringify`-ed string bound to
      // a `::jsonb` placeholder (it serializes the JS value again on top of the already-JSON
      // text), landing a jsonb SCALAR STRING instead of an object — pass the plain object and
      // let the driver serialize it once.
      await owner.unsafe(
        `insert into ${schema}.crm_settings (org_id, value) values ($1, $2::jsonb)`,
        [ORG_ID, { disabled_channels: ['whatsapp'], accounts: ['a1'] }],
      );

      // Mirrors the real call sequence: the route validates through
      // depositWriteSchema (trims, does NOT lowercase) before writeDepositRule
      // ever sees the patch.
      const patch = depositWriteSchema.parse({
        keywords: ['ADELANTO', ' seña '],
        label: 'Adelanto',
      });

      const result = await writeDepositRule(ctxFor(client), patch);
      expect(result.rule).toEqual({ keywords: ['adelanto', 'seña'], label: 'Adelanto' });
      expect(result).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });

      const [row] = await owner.unsafe<{ value: Record<string, unknown>; updated_at: string }[]>(
        `select value, updated_at from ${schema}.crm_settings where org_id = $1`,
        [ORG_ID],
      );
      expect(row).toBeDefined();
      // A sibling key this write never owns must survive untouched — the exact
      // property a mocked "the SQL contains ||" assertion cannot prove.
      expect(row!.value.disabled_channels).toEqual(['whatsapp']);
      expect(row!.value.accounts).toEqual(['a1']);

      const deposit = row!.value.deposit as {
        keywords: string[];
        label: string;
        updatedAt: string;
      };
      // Stored raw (trimmed, not lowercased) — normalization happens on READ,
      // not on write; see crm-settings.service.ts's normalizeDepositRule.
      expect(deposit.keywords).toEqual(['ADELANTO', 'seña']);
      expect(deposit.label).toBe('Adelanto');
      // updatedAt is server-stamped inside writeDepositRule, never client-suppliable.
      expect(Date.parse(deposit.updatedAt)).toBeGreaterThan(Date.now() - 10_000);
      expect(Date.parse(row!.updated_at)).toBeGreaterThan(Date.now() - 10_000);

      // Read back through the module's own reader, on the INDEPENDENT `owner`
      // connection — proves the write is durably visible, not an artifact of
      // reading through the same connection/transaction that wrote it.
      const resolved = await resolveDepositRule(ctxFor(owner));
      expect(resolved).toEqual({ keywords: ['adelanto', 'seña'], label: 'Adelanto' });
    });
  }, 30_000);

  it('a crm_win_embeddings row built before this write is surfaced as staleDerivedCount, not silently ignored', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      await owner.unsafe(
        `insert into ${schema}.crm_settings (org_id, value) values ($1, '{}'::jsonb)`,
        [ORG_ID],
      );
      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, gen_random_uuid(), now() - interval '1 hour')`,
        [ORG_ID],
      );

      const patch = depositWriteSchema.parse({ keywords: ['adelanto'] });
      const result = await writeDepositRule(ctxFor(client), patch);

      expect(result.staleDerived).toBe(true);
      expect(result.staleDerivedCount).toBe(1);
    });
  }, 30_000);

  it('a broadened rule can reconcile a formerly qualifying contact out of the complete win index', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      const contactId = '11111111-1111-4111-8111-111111111111';
      await owner.unsafe(
        `insert into ${schema}.crm_settings (org_id, value) values ($1, '{}'::jsonb)`,
        [ORG_ID],
      );
      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, $2::uuid, now() - interval '1 hour')`,
        [ORG_ID, contactId],
      );

      // Under the old/default `reserva` vocabulary, an `adelanto`-only buyer
      // could have produced the seeded row. Broadening the rule means the
      // rebuild's current contact set is empty.
      await writeDepositRule(
        ctxFor(client),
        depositWriteSchema.parse({ keywords: ['reserva', 'adelanto'] }),
      );
      await drizzle(client).transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org_id', ${ORG_ID}, true)`);
        await deleteMissingWinEmbeddings(tx, []);
      });

      const [{ count }] = await owner.unsafe<{ count: number }[]>(
        `select count(*)::int count from ${schema}.crm_win_embeddings where org_id = $1`,
        [ORG_ID],
      );
      expect(count).toBe(0);
    });
  }, 30_000);

  it('matching-equivalent retries and label-only edits preserve the classification version', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      const first = await writeDepositRule(
        ctxFor(client),
        depositWriteSchema.parse({ keywords: ['adelanto', 'seña'], label: 'Old' }),
      );
      expect(first.staleDerived).toBe(false);
      const [{ version: initialVersion }] = await owner.unsafe<{ version: string }[]>(
        `select value #>> '{deposit,updatedAt}' version from ${schema}.crm_settings where org_id = $1`,
        [ORG_ID],
      );
      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, gen_random_uuid(), now() - interval '1 hour')`,
        [ORG_ID],
      );

      const retry = await writeDepositRule(
        ctxFor(client),
        depositWriteSchema.parse({ keywords: [' SEÑA ', 'ADELANTO'], label: 'Old' }),
      );
      const labelOnly = await writeDepositRule(
        ctxFor(client),
        depositWriteSchema.parse({ keywords: ['adelanto', 'seña'], label: 'New' }),
      );
      const [{ version: finalVersion, label }] = await owner.unsafe<
        { version: string; label: string }[]
      >(
        `select value #>> '{deposit,updatedAt}' version, value #>> '{deposit,label}' label
         from ${schema}.crm_settings where org_id = $1`,
        [ORG_ID],
      );

      expect(retry).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });
      expect(labelOnly).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });
      expect(finalVersion).toBe(initialVersion);
      expect(label).toBe('New');
    });
  }, 30_000);

  /**
   * The ORDERING half of the ⚠️ A3 staleness disclosure, which the two tests
   * above cannot see because they run alone.
   *
   * `buildWinIndex` reads the deposit rule, leaves the database for its
   * embedding round-trips, and only then upserts `bought`/`snippet` with
   * `built_at = now()`. Before the deposit-config lock existed, a PUT that
   * arrived in that window stamped `updatedAt` from this process's clock the
   * instant it started, so a publication committing microseconds later
   * carried a NEWER `built_at` and escaped the `built_at < updatedAt` count:
   * old-rule rows reported as fresh.
   *
   * This test reproduces that interleaving with real transactions — `owner`
   * holds the same advisory lock the publication takes and commits an
   * old-rule row while `writeDepositRule` waits on it. The write must observe
   * that row afterwards, which is only true if it takes the lock BEFORE
   * stamping and stamps from the DATABASE clock.
   */
  it('a win-index publication that commits while the write waits on the deposit-config lock is still counted stale', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      await owner.unsafe(
        `insert into ${schema}.crm_settings (org_id, value) values ($1, '{}'::jsonb)`,
        [ORG_ID],
      );

      let releasePublication!: () => void;
      const publicationDone = new Promise<void>((resolve) => (releasePublication = resolve));
      let publicationHoldsLock!: () => void;
      const lockHeld = new Promise<void>((resolve) => (publicationHoldsLock = resolve));

      // The in-flight rebuild: holds the lock, then publishes an old-rule row.
      const publication = owner.begin(async (tx) => {
        await tx.unsafe(`set local search_path to ${schema}, public`);
        await tx.unsafe(`select pg_advisory_xact_lock(hashtext('crm-deposit-rule:' || $1::text))`, [
          ORG_ID,
        ]);
        publicationHoldsLock();
        await publicationDone;
        await tx.unsafe(
          `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
           values ($1, gen_random_uuid(), clock_timestamp())`,
          [ORG_ID],
        );
      });

      await lockHeld;
      const patch = depositWriteSchema.parse({ keywords: ['adelanto'] });
      let settled = false;
      const write = writeDepositRule(ctxFor(client), patch).then((r) => {
        settled = true;
        return r;
      });

      let blockedWhileLockHeld: boolean;
      try {
        // The write must be BLOCKED, not racing: without the lock it would
        // have stamped `updatedAt` already and missed the row published below.
        await new Promise((r) => setTimeout(r, 300));
        blockedWhileLockHeld = !settled;
      } finally {
        // Always let the publication commit — otherwise a failed expectation
        // above would leave its transaction open and `withSchema`'s teardown
        // would block on it until the test timeout, hiding the real reason.
        releasePublication();
        await publication;
      }
      const result = await write;

      expect(blockedWhileLockHeld).toBe(true);
      expect(result.staleDerivedCount).toBe(1);
      expect(result.staleDerived).toBe(true);
    });
  }, 30_000);
});
