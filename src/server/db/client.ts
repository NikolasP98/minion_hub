import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { env } from '$env/dynamic/private';
import * as schema from './schema';
import * as relations from './relations';

const allSchema = { ...schema, ...relations };

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  const url = env.TURSO_DB_URL ?? 'file:./data/minion_hub.db';
  const authToken = env.TURSO_DB_AUTH_TOKEN;
  const client = createClient({ url, authToken });
  return drizzle(client, { schema: allSchema });
}

export function getDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}

export type Db = ReturnType<typeof getDb>;
