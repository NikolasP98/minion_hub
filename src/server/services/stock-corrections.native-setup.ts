import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import {
  assertOperatorNativeAuthFixture,
  installOperatorNativeAuthFixture,
  type OwnedChildIdentity,
} from '../test-utils/operator-native-auth-fixture';

/**
 * Native-only helper (not a test), mirrors the F7 audit helper with the `correction` prefix: creates ONE owned child database on the qualified controller,
 * installs the canonical auth prerequisite and the real baseline, and drops the child in close().
 */
const ROOT = join(import.meta.dirname, '../../..');
const CHILD_MARKER = 'minion-360-disposable:v1';

export interface CorrectionNativeChild {
  identity: OwnedChildIdentity;
  /** Superuser/table-owner handle on the child (fixture controller). */
  owner: postgres.Sql;
  url: URL;
  close(): Promise<void>;
}

export async function openCorrectionNativeChild(): Promise<CorrectionNativeChild> {
  const controller = await openDisposablePostgres();
  const name = `minion_qc_faces_correction_${randomBytes(16).toString('hex')}`;
  await controller.owner.unsafe(`CREATE DATABASE ${name}`);
  await controller.owner.unsafe(`COMMENT ON DATABASE ${name} IS '${CHILD_MARKER}'`);
  const url = new URL(process.env.MINION_QC_DATABASE_URL!);
  url.pathname = `/${name}`;
  const owner = postgres(url.href, { max: 1, prepare: false, onnotice: () => undefined });
  const identity: OwnedChildIdentity = { name, marker: CHILD_MARKER, prefix: 'correction' };
  const close = async () => {
    await owner.end({ timeout: 5 }).catch(() => undefined);
    await controller.owner
      .unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      .catch(() => undefined);
    await controller.close();
  };
  try {
    await installOperatorNativeAuthFixture(owner, identity);
    await ensureRole(owner, 'supabase_admin', 'SUPERUSER NOLOGIN');
    await owner.unsafe(
      'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm',
    );
    const baseline = readFileSync(join(ROOT, 'supabase/qa/baseline/schema.sql'), 'utf8').replace(
      /^CREATE SCHEMA public;$/m,
      'CREATE SCHEMA IF NOT EXISTS public;',
    );
    const restore = spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', url.href],
      {
        input: `SET ROLE supabase_admin;\n${baseline}\nRESET ROLE;\n`,
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    if (restore.status !== 0)
      throw new Error(`baseline restore failed: ${restore.stderr.slice(-1500)}`);
    await owner.unsafe('REASSIGN OWNED BY supabase_admin TO minion_qc');
    // Explicit current-source lifecycle shape (migration 20261112010000), not proof about production.
    await owner.unsafe(`alter table public.organizations add column if not exists role_model text not null default 'legacy',
      add column if not exists default_role_key text;
      alter table public.profiles add column if not exists deletion_pending boolean not null default false`);
    await assertOperatorNativeAuthFixture(owner, identity);
    // Replay every committed migration newer than the baseline snapshot, in order, so the child has
    // the real current POS / scheduling / stock shape (same set CI's production runner applies).
    await applyMigrationsAfterBaseline(owner);
    // The role-simulation migration needs auth.sessions the fixture does not model; the audit writer only needs these two columns.
    await owner.unsafe(`alter table public.doc_audit_log
      add column if not exists simulation_role_key text,
      add column if not exists simulation_generation uuid`);
    return { identity, owner, url, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function ensureRole(owner: postgres.Sql, role: string, attrs: string) {
  const [row] = await owner.unsafe(`select 1 from pg_roles where rolname='${role}'`);
  if (!row) await owner.unsafe(`CREATE ROLE ${role} ${attrs}`).catch(() => undefined);
}

/** Only the POS / scheduling / stock / authority shape this suite exercises; notification/pulse/crm migrations need a production-faithful auth boundary the fixture does not model. */
const WANTED_MIGRATIONS =
  /_(pos_|fin_product|fin_products_kind|sched_booking_products|stk_|retire_sellable|event_types_follow|operator_authority|stock_corrections|record_lock_policy)/;

/** Files strictly newer than the baseline ledger version, ascending (includes the F7 bridge and F3 migrations). */
async function applyMigrationsAfterBaseline(owner: postgres.Sql): Promise<void> {
  const { maxLedgerVersion } = JSON.parse(
    readFileSync(join(ROOT, 'supabase/qa/baseline/baseline.json'), 'utf8'),
  ) as { maxLedgerVersion: string };
  const dir = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(dir)
    .filter(
      (f) =>
        f.endsWith('.sql') && f.replace(/_.*/, '') > maxLedgerVersion && WANTED_MIGRATIONS.test(f),
    )
    .sort()) {
    try {
      await owner.unsafe(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      throw new Error(`native fixture: migration ${file} failed: ${(error as Error).message}`);
    }
  }
}

function migration(file: string): string {
  return readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8');
}
/** F7 authority bridge (runtime dependency), then this feature's own migration. */
export const bridgeMigrationSql = () => migration('20261116190000_operator_authority_bridge.sql');
export const correctionMigrationSql = () => migration('20261116193000_stock_corrections.sql');
