#!/usr/bin/env bun
/**
 * Drizzle-vs-database column drift check.
 *
 * A Drizzle column with no matching DB column is INVISIBLE to `bun run check`
 * (the schema is internally consistent), but Drizzle's bare `.select()` emits an
 * explicit column list, so every read of that table 500s at runtime with
 * `column "x" does not exist`. That shipped on 2026-07-25 and took down
 * /pos/sell. This catches it in one second.
 *
 *   bun scripts/schema-drift-check.ts
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as stock from '../src/server/db/pg-schema/stock';
import * as fin from '../src/server/db/pg-finance-schema';
import * as pos from '../src/server/db/pg-pos-schema';

const url = (
  process.env.SUPABASE_DB_URL ??
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(
    /^SUPABASE_DB_URL=(.*)$/m,
  )?.[1] ??
  ''
)
  .trim()
  .replace(/^["']|["']$/g, '');
if (!url) throw new Error('SUPABASE_DB_URL not found');

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
const dbCols = new Map<string, Set<string>>();
for (const r of await sql<{ table_name: string; column_name: string }[]>`
  select table_name, column_name from information_schema.columns where table_schema = 'public'`) {
  (dbCols.get(r.table_name) ?? dbCols.set(r.table_name, new Set()).get(r.table_name)!).add(
    r.column_name,
  );
}

let bad = 0;
for (const mod of [stock, fin, pos]) {
  for (const v of Object.values(mod)) {
    if (!is(v, PgTable)) continue;
    const name = getTableName(v);
    const db = dbCols.get(name);
    if (!db) {
      console.log(`TABLE MISSING IN DB   ${name}`);
      bad++;
      continue;
    }
    for (const c of Object.values(getTableColumns(v))) {
      if (!db.has(c.name)) {
        console.log(`DRIFT  ${name}.${c.name}  — drizzle has it, DB does NOT`);
        bad++;
      }
    }
  }
}
console.log(
  bad === 0 ? '✅ no drift — every drizzle column exists in the DB' : `❌ ${bad} drift issue(s)`,
);
await sql.end();
process.exit(bad === 0 ? 0 : 1);
