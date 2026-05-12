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

let initialized = false;

const sourceId = env.VERCEL_DEPLOYMENT_ID ?? randomUUID();

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
export async function initCache(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const explicit = env.CACHE_BACKEND as Backend | undefined;
  const isProd = env.NODE_ENV === 'production';
  const backendName: Backend = explicit ?? (isProd ? 'noop' : 'memory');

  let backend: CacheBackend;
  if (backendName === 'valkey') {
    if (!env.VALKEY_URL) {
      console.warn('[cache] CACHE_BACKEND=valkey but VALKEY_URL unset — falling back to noop');
      backend = createBackend({ backend: 'noop' });
    } else {
      backend = await createBackendAsync({
        backend: 'valkey',
        url: env.VALKEY_URL,
        password: env.VALKEY_PASSWORD,
      });
    }
  } else {
    backend = createBackend({ backend: backendName });
  }

  const broadcastUrl = env.MINION_GATEWAY_BROADCAST_URL;
  const broadcastToken = env.OPENCLAW_GATEWAY_TOKEN;
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
