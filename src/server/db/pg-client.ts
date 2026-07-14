import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { getPgClient } from './pg-pool';

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  return drizzle(getPgClient(), { schema: pgSchema });
}

/** Singleton Drizzle-PG client. Reads/writes the relational-core tables in Supabase. */
export function getCoreDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}
