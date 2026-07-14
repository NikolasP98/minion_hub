import postgres from 'postgres';
import { env } from '$env/dynamic/private';

type PgClient = ReturnType<typeof postgres>;

interface PgPoolState {
  url: string;
  client: PgClient;
}

declare global {
  // SvelteKit can evaluate server modules more than once during HMR and a
  // serverless isolate can load separate route chunks. Keep the physical pool
  // on globalThis so all Drizzle wrappers in one process share it.
  var __minionHubPgPool: PgPoolState | undefined;
}

const DEFAULT_POOL_SIZE = 5;
const MAX_POOL_SIZE = 10;

function poolSize(): number {
  const configured = Number.parseInt(env.SUPABASE_DB_POOL_SIZE ?? '', 10);
  if (!Number.isFinite(configured)) return DEFAULT_POOL_SIZE;
  return Math.min(MAX_POOL_SIZE, Math.max(1, configured));
}

function databaseUrl(): string {
  const url = env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required for the PG client');
  return url;
}

/**
 * One bounded postgres-js pool per Hub process.
 *
 * Core queries and the RLS ledger use separate Drizzle schemas, but they can
 * safely share a physical pool: ledger role/GUC changes use SET LOCAL inside a
 * transaction and are reset automatically at commit. A short idle timeout and
 * finite connection lifetime keep dev reloads and retired serverless isolates
 * from holding Supabase connections indefinitely.
 */
export function getPgClient(): PgClient {
  const url = databaseUrl();
  const existing = globalThis.__minionHubPgPool;
  if (existing?.url === url) return existing.client;

  if (existing) {
    void existing.client.end({ timeout: 5 }).catch((err: unknown) => {
      console.warn('[pg-pool] failed to close replaced pool', err);
    });
  }

  const client = postgres(url, {
    prepare: false,
    max: poolSize(),
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 10 * 60,
  });
  globalThis.__minionHubPgPool = { url, client };
  return client;
}
