import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  const url = env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL is required for the PG core client');
  // Transaction mode (Supavisor port 6543): prepare:false required.
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client);
}

/** Singleton Drizzle-PG client. Reads/writes the relational-core tables in Supabase. */
export function getCoreDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}
