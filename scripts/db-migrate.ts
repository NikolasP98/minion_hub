#!/usr/bin/env bun
/**
 * Hub-owned Postgres migration runner.
 *
 * Applies pending files from supabase/migrations/*.sql, tracked in hub's OWN
 * `hub_migrations` ledger — deliberately independent of the shared, root-owned
 * `supabase_migrations.schema_migrations` table (this Supabase DB is shared with
 * the meta-repo project, so `supabase migration up` refuses to run from hub's
 * partial dir: LegacyMigrationMissingLocalError). See
 * specs/2026-07-07-hub-db-migration-pipeline.md.
 *
 * Gate for the Vercel PRODUCTION build (vercel-build = db:migrate && build): a
 * failed migration aborts the build, so the prior deploy stays live and code
 * never ships ahead of its schema. Preview/branch builds and local `bun run
 * build` SKIP (guard below).
 *
 * Uses hub's own postgres.js driver (no psql binary — Vercel's build image has
 * none). Each file applies + records atomically in ONE transaction under a
 * pg_advisory_xact_lock with a re-check inside the lock, so concurrent prod
 * builds are fully race-safe (works on the transaction pooler via prepare:false).
 *
 * Manual apply:  FORCE_DB_MIGRATE=1 SUPABASE_DB_URL=... bun run db:migrate
 * Show status:   bun run db:status
 */
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const LOCK_KEY = 826744; // single advisory-lock namespace for hub migrations
const versionOf = (file: string) => file.replace(/_.*/, '');

// ── guard: only touch prod on a production build or an explicit manual run ──
if (process.env.VERCEL_ENV !== 'production' && process.env.FORCE_DB_MIGRATE !== '1') {
	console.log(
		`db:migrate skipped — VERCEL_ENV='${process.env.VERCEL_ENV ?? 'unset'}' (set FORCE_DB_MIGRATE=1 to override)`,
	);
	process.exit(0);
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('db:migrate FAILED — SUPABASE_DB_URL is not set in this environment');
	process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith('.sql'))
	.sort();

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
	await sql`create table if not exists public.hub_migrations (version text primary key, applied_at timestamptz not null default now())`;
	const rows = await sql<{ version: string }[]>`select version from public.hub_migrations`;
	const applied = new Set(rows.map((r) => r.version));

	let count = 0;
	for (const file of files) {
		const ver = versionOf(file);
		if (applied.has(ver)) continue;
		const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
		console.log(`db:migrate — applying ${ver} (${file})…`);
		await sql.begin(async (tx) => {
			await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
			// re-check under the lock: a concurrent build may have applied it first
			const dup = await tx`select 1 from public.hub_migrations where version = ${ver}`;
			if (dup.length > 0) return;
			await tx.unsafe(body); // multi-statement DDL, no params → simple protocol
			await tx`insert into public.hub_migrations(version) values (${ver})`;
		});
		count++;
	}
	console.log(`db:migrate — done (${count} applied).`);
} catch (err) {
	console.error('db:migrate FAILED —', err instanceof Error ? err.message : err);
	process.exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}
