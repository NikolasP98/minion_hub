import {
  configureCache,
  createBackend,
  createBackendAsync,
  type Backend,
  type CacheBackend,
} from '@minion-stack/cache';
import { env } from '$env/dynamic/private';

let initialized = false;

/**
 * One-time cache initialization. Idempotent — safe to call from multiple
 * SSR loaders in case hooks.server.ts hasn't run yet (e.g. during prerender).
 *
 * Backend selection:
 *   - CACHE_BACKEND env wins if set ('memory' | 'valkey' | 'noop')
 *   - Else dev defaults to 'memory', production defaults to 'noop'
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

  configureCache({
    backend,
    namespace: 'hub',
    // Broadcaster wired up later when gateway receive endpoint ships.
    logger:
      env.CACHE_LOG === '1' || !isProd
        ? (evt) => console.log(`[cache] ${JSON.stringify(evt)}`)
        : undefined,
  });

  console.log(`[cache] initialized — backend=${backendName}`);
}
