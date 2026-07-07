#!/usr/bin/env bun
/**
 * Read-only migration status: which supabase/migrations/*.sql are applied (per
 * the hub_migrations ledger) vs pending. Requires SUPABASE_DB_URL.
 */
import postgres from 'postgres';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const versionOf = (file: string) => file.replace(/_.*/, '');

const url = process.env.SUPABASE_DB_URL;
if (!url) {
	console.error('db:status FAILED — SUPABASE_DB_URL is not set');
	process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith('.sql'))
	.sort();

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
	const rows = await sql<
		{ version: string }[]
	>`select version from public.hub_migrations`.catch(() => [] as { version: string }[]);
	const applied = new Set(rows.map((r) => r.version));
	let pending = 0;
	for (const file of files) {
		if (applied.has(versionOf(file))) {
			console.log(`  applied  ${file}`);
		} else {
			console.log(`  PENDING  ${file}`);
			pending++;
		}
	}
	console.log(`— ${pending} pending`);
} finally {
	await sql.end({ timeout: 5 });
}
