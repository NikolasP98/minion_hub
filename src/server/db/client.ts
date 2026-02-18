import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import * as relations from './relations';

const allSchema = { ...schema, ...relations };

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  const url = process.env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
  const authToken = process.env.TURSO_DB_AUTH_TOKEN;
  const client = createClient({ url, authToken });
  return drizzle(client, { schema: allSchema });
}

export function getDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}

export type Db = ReturnType<typeof getDb>;
