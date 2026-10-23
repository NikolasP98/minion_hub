import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as pgSchema from '@minion-stack/db/pg';
import { drizzle } from 'drizzle-orm/postgres-js';
import { applyHubMigration } from '../../../scripts/db-migrate-core';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';

/** Uses the existing marked fixture guard before any schema mutation. No app env fallback. */
export async function openPulsePostgres() {
  const harness = await openDisposablePostgres();
  await harness.owner.unsafe(
    "do $$ begin if not exists(select 1 from pg_roles where rolname='app_ledger') then create role app_ledger nologin nobypassrls; end if; end $$",
  );
  const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
  await harness.owner.unsafe(
    `create schema ${schema}; grant usage on schema ${schema} to app_ledger`,
  );
  const pg = harness.createConnection(schema);
  const peer = harness.createConnection(schema);
  const baseline = readFileSync(
    new URL('../../../supabase/qa/baseline/schema.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'organizations',
    'organization_members',
    'profiles',
    'member_roles',
    'permission_rules',
    'app_modules',
    'personal_agents',
    'gateway',
    'user_gateway',
    'gateway_lease',
    'bg_jobs',
  ]) {
    const match = baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`));
    if (!match) throw new Error(`Missing production fixture prerequisite ${table}`);
    await pg.unsafe(match[0].replaceAll('public.', ''));
  }
  // Production PKs are separate pg_dump ALTER statements.
  await pg.unsafe('alter table bg_jobs add primary key(id)');
  await pg.unsafe('alter table organizations add primary key(id)');
  await pg.unsafe('alter table profiles add primary key(id)');
  await pg.unsafe('alter table personal_agents add primary key(id)');
  await pg.unsafe('alter table user_gateway add primary key(profile_id,gateway_id)');
  await pg.unsafe('alter table gateway add primary key(id)');
  await pg.unsafe(
    'alter table bg_jobs add column if not exists lease_generation integer not null default 0',
  );
  await pg.unsafe(
    readFileSync(
      new URL('../../../supabase/migrations/20260718050000_pulse.sql', import.meta.url),
      'utf8',
    ).replaceAll('public.', ''),
  );
  const migration = readFileSync(
    new URL(
      '../../../supabase/migrations/20261023010000_pulse_dispatch_receipts.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await pg.unsafe(
    'create table hub_migrations(version text primary key,applied_at timestamptz not null default now())',
  );
  const migrate = () =>
    applyHubMigration(pg, { version: '20261023010000', body: migration, ledgerSchema: schema });
  await migrate();
  const digestMigration = readFileSync(
    new URL('../../../supabase/migrations/20261023020000_pulse_digest.sql', import.meta.url),
    'utf8',
  );
  const migrateDigest = () =>
    applyHubMigration(pg, {
      version: '20261023020000',
      body: digestMigration,
      ledgerSchema: schema,
    });
  await migrateDigest();
  const close = async () => {
    await harness.owner.unsafe(`drop schema ${schema} cascade`);
    await harness.close();
  };
  return {
    harness,
    schema,
    pg,
    peer,
    rerunSql: () => pg.unsafe(migration),
    db: drizzle(pg, { schema: pgSchema }),
    peerDb: drizzle(peer, { schema: pgSchema }),
    migrate,
    migrateDigest,
    rerunDigestSql: () => pg.unsafe(digestMigration),
    close,
  };
}
