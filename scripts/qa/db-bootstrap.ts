#!/usr/bin/env bun
/**
 * Idempotent QA database bootstrap:
 *   roles (if missing) -> extensions -> baseline restore (schema.sql +
 *   ledger.sql, first run only) -> the PRODUCTION migration runner
 *   (scripts/db-migrate.ts, unchanged) -> scripts/db-status.ts gate (0
 *   pending or exit 1) -> PostgREST schema reload -> a marker comment.
 *
 * Never-prod guard: refuses any URL that isn't loopback on the QA stack's
 * fixed db port (see scripts/qa/qa-database-guard.ts) before opening a
 * connection.
 *
 * Usage: bun scripts/qa/db-bootstrap.ts [--db-url <url>] [--allow-port] [--json]
 *   --db-url     defaults to postgresql://postgres:postgres@127.0.0.1:54422/postgres
 *   --allow-port skip the fixed-port check (still loopback-only)
 *   --json       print one JSON summary line instead of prose logs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { copyBlocksToInserts } from './copy-to-inserts';
import { validateQaDatabaseUrl } from './qa-database-guard';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..'); // scripts/qa -> repo root
const BASELINE_DIR = join(ROOT, 'supabase', 'qa', 'baseline');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const DB_MARKER = 'minion-hub-qa:v1';
const ROLES = ['app_ledger', 'app_assistant_ro', 'brain_vector_worker'] as const;

/** Counts the data rows a ledger.sql (COPY or --inserts format) will restore, without touching a database. */
function countLedgerRows(ledgerSql: string): number {
  const asInserts = ledgerSql.includes('FROM stdin;') ? copyBlocksToInserts(ledgerSql) : ledgerSql;
  return (asInserts.match(/^INSERT INTO\b/gim) ?? []).length;
}

/** `YYYYMMDDHHMMSS_name.sql` -> `YYYYMMDDHHMMSS`. Same convention as scripts/db-migrate.ts. */
function versionOf(file: string): string {
  return file.replace(/_.*/, '');
}

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}
const json = argv.includes('--json');
const allowPort = argv.includes('--allow-port');

function log(message: string): void {
  if (!json) console.log(message);
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/** spawnSync sets .error with ENOENT when the binary isn't on PATH. */
function binaryExists(bin: string): boolean {
  const result = spawnSync(bin, ['--version'], { stdio: 'ignore' });
  return result.error === undefined || (result.error as NodeJS.ErrnoException).code !== 'ENOENT';
}

const summary: Record<string, unknown> = {};

async function main(): Promise<void> {
  const url = validateQaDatabaseUrl(argValue('--db-url') ?? DEFAULT_DB_URL, { allowPort });
  const dbUrl = url.toString();
  summary.dbUrl = `${url.protocol}//${url.hostname}:${url.port}${url.pathname}`;

  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    // The role the app/bootstrap connects as (`postgres` by default) needs
    // membership in each of these so `set_config('role', '<role>', true)`
    // (src/server/db/with-org-core.ts's RLS-scoping pattern — equivalent to
    // `SET LOCAL ROLE`) is even allowed to switch into them. Prod grants this
    // membership outside the migration pipeline (schema.sql, being a
    // --schema=public dump, can't capture cluster-level role grants any more
    // than it could capture the roles themselves), so this stack must too.
    const connectingUser = decodeURIComponent(url.username);
    log(`qa:bootstrap — ensuring roles (and granting them to ${connectingUser})…`);
    for (const role of ROLES) {
      const [existing] = await sql`select 1 from pg_roles where rolname = ${role}`;
      if (existing) {
        log(`  ${role} already exists`);
      } else {
        await sql.unsafe(`create role ${role} nologin noinherit nobypassrls`);
        log(`  created ${role}`);
      }
      await sql.unsafe(`grant ${quoteIdent(role)} to ${quoteIdent(connectingUser)}`);
    }

    log('qa:bootstrap — ensuring extensions (vector, pg_trgm)…');
    await sql.unsafe('create extension if not exists vector');
    await sql.unsafe('create extension if not exists pg_trgm');

    const [{ ledgerExists }] = await sql<{ ledgerExists: boolean }[]>`
			select exists (
				select 1 from information_schema.tables
				where table_schema = 'public' and table_name = 'hub_migrations'
			) as "ledgerExists"`;

    if (ledgerExists) {
      log('qa:bootstrap — public.hub_migrations already present; skipping baseline restore');
      summary.baselineRestored = false;
    } else {
      log('qa:bootstrap — public.hub_migrations missing; restoring the committed baseline…');
      const schemaPath = join(BASELINE_DIR, 'schema.sql');
      const ledgerPath = join(BASELINE_DIR, 'ledger.sql');
      if (!existsSync(schemaPath) || !existsSync(ledgerPath)) {
        throw new Error(
          `no baseline at ${BASELINE_DIR} — run "bun run qa:snapshot --confirm-prod-read" first ` +
            '(owner-only, needs production credentials in .env.local)',
        );
      }
      await restoreSqlFile(schemaPath, dbUrl);
      await restoreSqlFile(ledgerPath, dbUrl);
      summary.baselineRestored = true;

      // Hard gate: the restore must have loaded every row ledger.sql has, or
      // db-migrate.ts will silently paper over the gap by re-running whatever
      // migrations correspond to the missing versions — harmless only when
      // they happen to be idempotent, and otherwise a confusing failure far
      // from its actual cause.
      const expectedLedgerRows = countLedgerRows(readFileSync(ledgerPath, 'utf8'));
      const [{ actualLedgerRows }] = await sql<
        { actualLedgerRows: number }[]
      >`select count(*)::int as "actualLedgerRows" from public.hub_migrations`;
      if (actualLedgerRows !== expectedLedgerRows) {
        throw new Error(
          `ledger restore row-count mismatch: ledger.sql has ${expectedLedgerRows} row(s) but ` +
            `public.hub_migrations has ${actualLedgerRows} after restoring it — the restore is incomplete`,
        );
      }
      summary.ledgerRowsRestored = actualLedgerRows;
      log(`  ledger row-count check: ${actualLedgerRows}/${expectedLedgerRows} rows restored ✓`);
    }

    log(
      'qa:bootstrap — running the production migration runner (FORCE_DB_MIGRATE=1 bun scripts/db-migrate.ts)…',
    );
    const migrate = spawnSync('bun', [join(ROOT, 'scripts', 'db-migrate.ts')], {
      // Baseline tables are owned by the restore user. Supabase's local
      // postgres role is not a superuser and cannot ALTER those tables.
      // dbUrl has already passed the loopback/port guard above; this changes
      // only QA bootstrap, never the production runner's connection policy.
      env: {
        ...process.env,
        SUPABASE_DB_URL: withUser(dbUrl, 'supabase_admin'),
        FORCE_DB_MIGRATE: '1',
      },
      encoding: 'utf8',
    });
    if (!json) {
      if (migrate.stdout) process.stdout.write(migrate.stdout);
      if (migrate.stderr) process.stderr.write(migrate.stderr);
    }
    if (migrate.status !== 0) throw new Error('scripts/db-migrate.ts failed — see output above');

    // If the baseline snapshot already covers every migration file on disk,
    // db-migrate.ts applying anything at all here is the exact symptom of a
    // ledger restore that silently lost rows (the row-count check above is
    // the direct guard; this is a second, independent tripwire on the
    // runner's own behavior). If the baseline predates newer migration files
    // on this branch, applying them is expected — warn, don't fail.
    const appliedVersions = [...migrate.stdout.matchAll(/db:migrate — applying (\d+)/g)].map(
      (m) => m[1],
    );
    const newestMigrationVersion = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map(versionOf)
      .sort()
      .at(-1);
    const baselineJsonPath = join(BASELINE_DIR, 'baseline.json');
    if (existsSync(baselineJsonPath)) {
      const baseline = JSON.parse(readFileSync(baselineJsonPath, 'utf8')) as {
        maxLedgerVersion?: string;
      };
      if (baseline.maxLedgerVersion === newestMigrationVersion) {
        if (appliedVersions.length > 0) {
          throw new Error(
            `baseline.json says the snapshot already covers every migration (maxLedgerVersion=${baseline.maxLedgerVersion}), ` +
              `but scripts/db-migrate.ts just applied ${appliedVersions.length}: ${appliedVersions.join(', ')} — ` +
              'the ledger restore almost certainly lost rows',
          );
        }
      } else if (appliedVersions.length > 0) {
        console.warn(
          `qa:bootstrap WARNING — baseline.json.maxLedgerVersion (${baseline.maxLedgerVersion}) is behind the ` +
            `newest migration file on this branch (${newestMigrationVersion}); scripts/db-migrate.ts applied ` +
            `${appliedVersions.length} migration(s) on top of the baseline: ${appliedVersions.join(', ')}`,
        );
      }
    }

    log('qa:bootstrap — checking migration status (scripts/db-status.ts)…');
    const status = spawnSync('bun', [join(ROOT, 'scripts', 'db-status.ts')], {
      env: { ...process.env, SUPABASE_DB_URL: dbUrl },
      encoding: 'utf8',
    });
    if (!json && status.stdout) process.stdout.write(status.stdout);
    if (status.status !== 0) throw new Error('scripts/db-status.ts failed to run');
    const pendingMatch = status.stdout.match(/—\s*(\d+)\s*pending/);
    if (!pendingMatch)
      throw new Error('could not parse the pending-migration count from db-status.ts output');
    const pending = Number(pendingMatch[1]);
    summary.pendingMigrations = pending;
    if (pending > 0) {
      throw new Error(
        `${pending} migration(s) still pending after db-migrate.ts ran — bootstrap incomplete`,
      );
    }

    log('qa:bootstrap — reloading the PostgREST schema cache…');
    await sql.unsafe("notify pgrst, 'reload schema'");

    const dbName = url.pathname.slice(1) || 'postgres';
    await sql.unsafe(`comment on database ${quoteIdent(dbName)} is '${DB_MARKER}'`);
    summary.marker = DB_MARKER;

    summary.ok = true;
    if (json) {
      console.log(JSON.stringify(summary));
    } else {
      console.log('qa:bootstrap — done: 0 pending migrations, roles/extensions/baseline in place.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Same connection string with the username swapped — nothing else changes. */
function withUser(dbUrl: string, user: string): string {
  const u = new URL(dbUrl);
  u.username = user;
  return u.toString();
}

/**
 * Restores a baseline SQL file inside one transaction: psql if present, else
 * postgres.js `unsafe` on the whole text.
 *
 * Connects as `supabase_admin`, not the given `--db-url`'s user (`postgres`
 * by default): prod's dumped default-privilege grants are recorded
 * `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` (that's who ran
 * Supabase's own provisioning), and the Supabase local stack's `postgres`
 * role is deliberately NOT a superuser — only `supabase_admin` is — so it
 * can't alter another role's default privileges. `supabase_admin` is a
 * fixed, publicly-documented local-stack account (password `postgres`,
 * same convention as the `postgres` role itself); this never applies
 * outside the loopback-only, port-guarded local QA database.
 */
async function restoreSqlFile(path: string, dbUrl: string): Promise<void> {
  const label = path.split('/').pop();
  const raw = readFileSync(path, 'utf8');
  // The target already has an empty `public` schema — the Supabase Postgres
  // image creates it on boot — but pg_dump --schema=public still emits an
  // unconditional `CREATE SCHEMA public;` (correct for restoring into a
  // schema-less database, wrong for restoring on top of this one). Patch
  // just that one statement rather than dropping and recreating the schema,
  // which would also cascade-drop the extensions bootstrap just created in it.
  let patched = raw.replace(/^CREATE SCHEMA public;$/m, 'CREATE SCHEMA IF NOT EXISTS public;');
  // Belt-and-suspenders for a baseline snapshotted before snapshot-sanitize.ts
  // learned to keep this line (see its comment): without it, Postgres
  // validates a PL/pgSQL function body's table references at CREATE FUNCTION
  // time, and this schema defines at least one function before its table.
  if (!/^SET\s+check_function_bodies\s*=\s*false;$/m.test(patched)) {
    patched = `SET check_function_bodies = false;\n${patched}`;
  }

  const adminUrl = withUser(dbUrl, 'supabase_admin');

  if (binaryExists('psql')) {
    log(`  restoring ${label} via psql (as supabase_admin)…`);
    // --single-transaction: psql otherwise auto-commits each statement, so an
    // error partway through (as happened while diagnosing this restore path)
    // leaves a half-applied schema instead of the "inside one transaction
    // each" restore the spec calls for.
    const result = spawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '--single-transaction', adminUrl], {
      input: patched,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`psql restore of ${label} failed:\n${result.stderr}`);
    }
    return;
  }
  log(`  restoring ${label} via postgres.js (no local psql binary, as supabase_admin)…`);
  // pg_dump output contains multi-statement DDL and $$-quoted function
  // bodies; `unsafe` with no params sends it as-is via the simple query
  // protocol, which handles that correctly (same trick db-migrate.ts uses).
  // The simple query protocol can't speak COPY though — snapshot-prod-schema.ts
  // dumps ledger.sql with --inserts to avoid that, but tolerate an
  // older/hand-made COPY-format file too by converting it first.
  const text = patched.includes('FROM stdin;') ? copyBlocksToInserts(patched) : patched;
  const adminSql = postgres(adminUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await adminSql.begin(async (tx) => {
      await tx.unsafe(text);
    });
  } finally {
    await adminSql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: message }));
  } else {
    console.error(`qa:bootstrap FAILED — ${message}`);
  }
  process.exitCode = 1;
});
