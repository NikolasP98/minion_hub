// Short-TTL, in-process cache for resolved request identities.
//
// The per-request auth path (resolveViaSupabase in resolve-identity.ts) costs a
// JWT verification plus 2–3 PostgREST round-trips. A single page navigation +
// its client `/api/*` fan-out fire many requests carrying the SAME access token
// within seconds, so memoizing the resolved identity per token collapses that
// repeated work to a map lookup.
//
// Keyed by the signed access-token JWT (+ the active-org cookie). Keying by the
// token is safe: a forged/expired token never matches a previously cached entry
// because the caller only caches AFTER successful signature verification — a bad
// token is rejected before it ever reaches `set`. Staleness (role / membership
// changes) is bounded by the TTL. Set AUTH_IDENTITY_CACHE_TTL_MS=0 to disable.
//
// In-process only: on Vercel each warm function instance keeps its own cache,
// which is exactly the bursty single-user traffic this targets. No external
// store, no cross-instance coherence to reason about.

import { env } from '$env/dynamic/private';

interface Entry<V> {
  value: V;
  expires: number;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 5_000;

const store = new Map<string, Entry<unknown>>();

/** Resolved TTL in ms; 0 (or invalid) disables caching entirely. */
function ttlMs(): number {
  const raw = env.AUTH_IDENTITY_CACHE_TTL_MS;
  if (raw === undefined || raw === '') return DEFAULT_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS;
}

/** Return a cached value if present and unexpired, else null. */
export function getCachedIdentity<V>(key: string, now: number = Date.now()): V | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expires <= now) {
    store.delete(key);
    return null;
  }
  // Touch for pseudo-LRU: re-insert so the oldest key stays at the front.
  store.delete(key);
  store.set(key, hit);
  return hit.value as V;
}

/** Cache a value under key. No-op when TTL is 0. Evicts oldest at capacity. */
export function setCachedIdentity<V>(key: string, value: V, now: number = Date.now()): void {
  const ttl = ttlMs();
  if (ttl <= 0) return;
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: now + ttl });
}

/** Drop a single entry (e.g. on explicit sign-out / role change). */
export function invalidateCachedIdentity(key: string): void {
  store.delete(key);
}

/** Test/maintenance: wipe the whole cache. */
export function clearIdentityCache(): void {
  store.clear();
}

/** Test/introspection: current number of live entries. */
export function identityCacheSize(): number {
  return store.size;
}
