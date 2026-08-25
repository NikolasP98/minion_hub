import {
  configureCache,
  createBackend,
  createBackendAsync,
  HttpBroadcaster,
  NoopBroadcaster,
  type Backend,
  type CacheBackend,
  type CacheBroadcaster,
  type CacheLogger,
} from '@minion-stack/cache';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import { getSystemGatewayCredentials as getSystemGatewayCredentialsPg } from '$server/services/gateway.pg.service';
import { recordCacheEvent } from '$lib/server/performance-context';
import { instrumentCacheBackend } from '$lib/server/cache-backend-instrumentation';

let initPromise: Promise<void> | null = null;
let dataPlanePromise: Promise<CacheRuntime> | null = null;

interface CacheRuntime {
  backend: CacheBackend;
  backendName: Backend;
  logger: CacheLogger;
}

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
 *   - If MINION_GATEWAY_BROADCAST_URL and a gateway-row token are available → HttpBroadcaster
 *   - OPENCLAW_GATEWAY_TOKEN is a last-resort token for a fresh deploy
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

/** Make cached reads available before the gateway-token lookup used only by
 * cross-runtime invalidation. The first app request awaits this short path;
 * broadcaster discovery continues through initCache() without holding every
 * dashboard cache behind an unrelated database round trip. */
function getCacheRuntime(): Promise<CacheRuntime> {
  if (!dataPlanePromise) {
    dataPlanePromise = doInitCacheDataPlane().catch((error) => {
      dataPlanePromise = null;
      throw error;
    });
  }
  return dataPlanePromise;
}

export async function initCacheDataPlane(): Promise<void> {
  await getCacheRuntime();
}

async function doInitCacheDataPlane(): Promise<CacheRuntime> {
  const explicit = cleanEnv(env.CACHE_BACKEND) as Backend | undefined;
  const isProd = env.NODE_ENV === 'production';
  const backendName: Backend = explicit ?? (isProd ? 'noop' : 'memory');

  // H9: the `memory` backend is per-instance. Its broadcaster only emits to the
  // gateway, never to peer hub Lambdas — so on a multi-instance host (Vercel)
  // a tenant-data invalidation on one warm function never reaches the others,
  // and they serve stale data for the full TTL. Warn loudly; memory is only
  // correct on a single long-lived instance.
  if (backendName === 'memory' && cleanEnv(env.VERCEL)) {
    console.warn(
      '[cache] CACHE_BACKEND=memory on Vercel (multi-instance): invalidations are NOT propagated to peer instances — tenant data can be stale for the full TTL. Set CACHE_BACKEND=valkey (with VALKEY_URL) or =noop for correct cross-instance behavior.',
    );
  }

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

  const logger: CacheLogger = (evt) => {
    recordCacheEvent(evt);
    if (env.CACHE_LOG === '1' || !isProd) console.log(`[cache] ${JSON.stringify(evt)}`);
  };
  const runtime = { backend: instrumentCacheBackend(backend), backendName, logger };
  configureRuntime(runtime, new NoopBroadcaster());
  console.log(`[cache] data plane ready — backend=${backendName}`);
  return runtime;
}

function configureRuntime(runtime: CacheRuntime, broadcaster: CacheBroadcaster): void {
  configureCache({
    backend: runtime.backend,
    namespace: 'hub',
    broadcaster,
    source: 'hub',
    sourceId,
    logger: runtime.logger,
  });
}

async function doInitCache(): Promise<void> {
  const runtime = await getCacheRuntime();

  const broadcastUrl = cleanEnv(env.MINION_GATEWAY_BROADCAST_URL);
  // Token comes from the encrypted Supabase `gateway` row (system-of-record) —
  // not from a duplicated env var. Last-resort env.OPENCLAW_GATEWAY_TOKEN for a
  // fresh deploy with no gateway row yet.
  let broadcastToken: string | null = null;
  try {
    const creds = await getSystemGatewayCredentialsPg(env.MINION_GATEWAY_PRIMARY_URL);
    broadcastToken = creds?.token ?? null;
  } catch (err) {
    console.warn('[cache] Supabase gateway token lookup failed', err);
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
      console.warn(
        '[cache] MINION_GATEWAY_BROADCAST_URL unset — invalidations not broadcast to gateway',
      );
    } else if (!broadcastToken) {
      console.warn('[cache] no gateway token available — invalidations not broadcast');
    }
  }

  configureRuntime(runtime, broadcaster);

  console.log(
    `[cache] initialized — backend=${runtime.backendName} sourceId=${sourceId.slice(0, 8)}`,
  );
}
