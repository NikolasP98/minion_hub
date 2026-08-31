import postgres from 'postgres';
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

async function backendPid(client: Client): Promise<number> {
  const [row] = await client<{ pid: number }[]>`select pg_backend_pid() as pid`;
  return row!.pid;
}

async function waitUntilBlocked(observer: Client, pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await observer<{ wait_event_type: string | null }[]>`
      select wait_event_type from pg_stat_activity where pid = ${pid}
    `;
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} did not block on the deposit-rule advisory lock`);
}

/**
 * Seeds `crm_settings.value` as a real jsonb OBJECT and proves it landed as
 * one before any assertion depends on it.
 *
 * ★ The cast is `::text::jsonb`, not `::jsonb`, and that is load-bearing.
 * postgres-js is opened with `prepare: false` (matching `pg-pool.ts`), so every
 * parameterised statement takes the describe-first path: it Parses, waits for
 * the server's `ParameterDescription`, then Binds using the SERVER-declared
 * parameter types (`connection.js` → `ParameterDescription` → `prepared` →
 * `Bind`). `Bind` runs `options.serializers[type]` on the value, and
 * postgres-js registers `JSON.stringify` for both json OIDs (114 and 3802).
 * With `$2::jsonb` PostgreSQL declares the parameter as jsonb, so an
 * already-`JSON.stringify`-ed argument is stringified a SECOND time and the row
 * stores the jsonb string `"{\"disabled_channels\":…}"` — a scalar, not an
 * object. `'"…"'::jsonb || '{"deposit":…}'::jsonb` then evaluates to a jsonb
 * ARRAY, which is why the sibling-key assertions read `undefined`.
 * `$2::text::jsonb` declares the parameter as text, so the raw string goes on
 * the wire and PostgreSQL parses it into an object.
 *
 * Drizzle's own jsonb binding (`.values({ value: … })`) is unaffected — only
 * hand-written `${JSON.stringify(x)}::jsonb` parameters hit this.
 */
async function seedJsonb(
  owner: Client,
  schema: string,
  orgId: string,
  value: Record<string, unknown>,
): Promise<void> {
  await owner.unsafe(
    `insert into ${schema}.crm_settings (org_id, value) values ($1, $2::text::jsonb)`,
    [orgId, JSON.stringify(value)],
  );
  const [seeded] = await owner.unsafe<{ kind: string }[]>(
    `select jsonb_typeof(value) as kind from ${schema}.crm_settings where org_id = $1`,
    [orgId],
  );
  // Fail HERE, on the fixture, if the seed ever silently double-encodes again
  // — not twenty lines later on an assertion about the shipped merge.
  expect(seeded?.kind).toBe('object');
}

describe.runIf(Boolean(databaseUrl))('writeDepositRule against real PostgreSQL', () => {
  it('merges the deposit key without disturbing a sibling key, stamps updatedAt server-side, and resolveDepositRule agrees immediately', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      // ★ `$2::text::jsonb`, NOT `$2::jsonb` — see seedJsonb's doc comment. A
      //   `$2::jsonb` seed here stores a jsonb STRING, and `string || object`
      //   yields a jsonb ARRAY, so every sibling-key assertion below reads
      //   `undefined` and blames the shipped merge for a fixture defect.
      await seedJsonb(owner, schema, ORG_ID, {
        disabled_channels: ['whatsapp'],
        accounts: ['a1'],
      });

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

      // Asserted in SQL, not through Drizzle: `mapFromDriverValue` JSON.parses a
      // string-typed jsonb column, so a double-encoded write round-trips
      // invisibly through the ORM. `jsonb_typeof` is the only reader that can
      // tell "an object" from "a string that looks like one", and everything
      // that reads this row in SQL (`value->'deposit'`, `#>>`) depends on the
      // difference.
      const [kinds] = await owner.unsafe<{ doc: string; deposit: string }[]>(
        `select jsonb_typeof(value) as doc, jsonb_typeof(value->'deposit') as deposit
           from ${schema}.crm_settings where org_id = $1`,
        [ORG_ID],
      );
      expect(kinds).toMatchObject({ doc: 'object', deposit: 'object' });

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

  it('counts an old-rule publication committed while the settings writer waits for the advisory lock', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      await owner.unsafe('begin');
      await owner.unsafe(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `crm-deposit-rule:${ORG_ID}`,
      ]);
      const writerPid = await backendPid(client);
      const writePromise = writeDepositRule(
        ctxFor(client),
        depositWriteSchema.parse({ keywords: ['adelanto'] }),
      );
      await waitUntilBlocked(owner, writerPid);

      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, gen_random_uuid(), now())`,
        [ORG_ID],
      );
      await owner.unsafe('commit');

      await expect(writePromise).resolves.toMatchObject({
        staleDerived: true,
        staleDerivedCount: 1,
      });
    });
  }, 30_000);

  it('an unchanged normalized rule leaves existing embeddings current', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      await seedJsonb(owner, schema, ORG_ID, {
        deposit: { keywords: [' ADELANTO ', 'seña'], label: 'Adelanto' },
      });
      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, gen_random_uuid(), now() - interval '1 hour')`,
        [ORG_ID],
      );

      const patch = depositWriteSchema.parse({
        keywords: ['adelanto', 'SEÑA'],
        label: 'Adelanto',
      });
      const result = await writeDepositRule(ctxFor(client), patch);

      expect(result).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });
    });
  }, 30_000);

  it('a label-only edit leaves existing embeddings current', async () => {
    await withSchema(async ({ schema, owner, client }) => {
      await seedJsonb(owner, schema, ORG_ID, {
        deposit: { keywords: ['adelanto', 'seña'], label: 'Adelanto' },
      });
      await owner.unsafe(
        `insert into ${schema}.crm_win_embeddings (org_id, contact_id, built_at)
         values ($1, gen_random_uuid(), now() - interval '1 hour')`,
        [ORG_ID],
      );

      const patch = depositWriteSchema.parse({
        keywords: ['seña', 'adelanto'],
        label: 'Reserva',
      });
      const result = await writeDepositRule(ctxFor(client), patch);

      expect(result).toMatchObject({ staleDerived: false, staleDerivedCount: 0 });
    });
  }, 30_000);
});
