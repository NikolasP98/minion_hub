import {
  configureCache,
  createBackend,
  createBackendAsync,
  HttpBroadcaster,
  NoopBroadcaster,
  type Backend,
  type CacheBackend,
  type CacheBroadcaster,
} from '@minion-stack/cache';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import { getDb } from '$server/db/client';
import { getSystemGatewayCredentials } from '$server/services/server.service';
import { getSystemGatewayCredentials as getSystemGatewayCredentialsPg } from '$server/services/gateway.pg.service';

let initPromise: Promise<void> | null = null;

const sourceId = env.VERCEL_DEPLOYMENT_ID ?? randomUUID();

/** Env values can carry stray whitespace/newlines (e.g. `echo x | vercel env add`
 *  appends a trailing \n). An untrimmed CACHE_BACKEND="valkey\n" silently fails
 *  the `=== 'valkey'` check and crashes init. Always trim; empty → undefined. */
const cleanEnv = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/**
 * One-time cache initialization. Idempotent — safe to call from multiple
 * SSR loaders in case hooks.server.ts hasn't run yet (e.g. during prerender).
 *
 * Backend selection:
 *   - CACHE_BACKEND env wins if set ('memory' | 'valkey' | 'noop')
 *   - Else dev defaults to 'memory', production defaults to 'noop'
 *
 * Broadcaster selection:
 *   - If MINION_GATEWAY_BROADCAST_URL + OPENCLAW_GATEWAY_TOKEN set → HttpBroadcaster
 *   - Else NoopBroadcaster (cross-runtime invalidation disabled)
 *
 * Valkey is selected via createBackendAsync since it dynamically imports
 * ioredis. We block on it once at boot.
 */
export function initCache(): Promise<void> {
  // Share a single in-flight init across concurrent callers; on failure, reset
  // so a later request can retry (previously `initialized = true` was set before
  // the await, so one failed init permanently wedged the cache as "configured
  // never called" → every cached() read 500'd).
  if (!initPromise) {
    initPromise = doInitCache().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doInitCache(): Promise<void> {
  const explicit = cleanEnv(env.CACHE_BACKEND) as Backend | undefined;
  const isProd = env.NODE_ENV === 'production';
  const backendName: Backend = explicit ?? (isProd ? 'noop' : 'memory');

  let backend: CacheBackend;
  if (backendName === 'valkey') {
    const valkeyUrl = cleanEnv(env.VALKEY_URL);
    if (!valkeyUrl) {
      console.warn('[cache] CACHE_BACKEND=valkey but VALKEY_URL unset — falling back to noop');
      backend = createBackend({ backend: 'noop' });
    } else {
      backend = await createBackendAsync({
        backend: 'valkey',
        url: valkeyUrl,
        password: cleanEnv(env.VALKEY_PASSWORD),
      });
    }
  } else {
    backend = createBackend({ backend: backendName });
  }

  const broadcastUrl = cleanEnv(env.MINION_GATEWAY_BROADCAST_URL);
  // Token comes from the encrypted DB row (single source of truth) — not from a
  // duplicated env var. Primary: Supabase `gateway` (system-of-record). Fallback:
  // legacy Turso `servers` (Track A2 kill-switch GATEWAY_TURSO_FALLBACK). Last:
  // env.OPENCLAW_GATEWAY_TOKEN for a fresh deploy with no gateway row yet.
  let broadcastToken: string | null = null;
  try {
    const creds = await getSystemGatewayCredentialsPg(env.MINION_GATEWAY_PRIMARY_URL);
    broadcastToken = creds?.token ?? null;
  } catch (err) {
    console.warn('[cache] Supabase gateway token lookup failed', err);
  }
  if (!broadcastToken && env.GATEWAY_TURSO_FALLBACK !== 'false') {
    try {
      const creds = await getSystemGatewayCredentials(getDb(), env.MINION_GATEWAY_PRIMARY_URL);
      broadcastToken = creds?.token ?? null;
    } catch (err) {
      console.warn('[cache] Turso servers token lookup failed', err);
    }
  }
  if (!broadcastToken && env.OPENCLAW_GATEWAY_TOKEN) {
    console.warn(
      '[cache] falling back to OPENCLAW_GATEWAY_TOKEN env var — add a host in /settings/hosts to migrate the secret to the DB',
    );
    broadcastToken = env.OPENCLAW_GATEWAY_TOKEN;
  }
  let broadcaster: CacheBroadcaster;
  if (broadcastUrl && broadcastToken) {
    broadcaster = new HttpBroadcaster({
      url: broadcastUrl,
      token: broadcastToken,
    });
    console.log(`[cache] broadcaster=http url=${broadcastUrl}`);
  } else {
    broadcaster = new NoopBroadcaster();
    if (!broadcastUrl) {
      console.warn('[cache] MINION_GATEWAY_BROADCAST_URL unset — invalidations not broadcast to gateway');
    } else if (!broadcastToken) {
      console.warn('[cache] no gateway token available — invalidations not broadcast');
    }
  }

  configureCache({
    backend,
    namespace: 'hub',
    broadcaster,
    source: 'hub',
    sourceId,
    logger:
      env.CACHE_LOG === '1' || !isProd
        ? (evt) => console.log(`[cache] ${JSON.stringify(evt)}`)
        : undefined,
  });

  console.log(`[cache] initialized — backend=${backendName} sourceId=${sourceId.slice(0, 8)}`);
}
