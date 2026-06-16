import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as pgSchema from '@minion-stack/db/pg';

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  // Trim stray whitespace/newlines — `echo x | vercel env add` appends a \n,
  // and a trailing newline in the connection URL breaks the postgres-js parser.
  const url = env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required for the PG core client');
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client, { schema: pgSchema });
}

/** Singleton Drizzle-PG client. Reads/writes the relational-core tables in Supabase. */
export function getCoreDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}
