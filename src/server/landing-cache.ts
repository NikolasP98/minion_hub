/**
 * Per-user landing-page cache, shared between the `/` redirect in
 * hooks.server.ts (read/write) and the preferences PUT handler (invalidate).
 * `resolveLandingPage` runs a PG SELECT on every `/` hit; the preference
 * changes rarely, so a short-TTL cache collapses the repeated SELECT.
 * ponytail: cap at 1000 users; FIFO-evict at capacity.
 */
const TTL_MS = 60_000;
const MAX = 1000;
const cache = new Map<string, { value: string; expires: number }>();

export function getCachedLanding(supabaseId: string): string | undefined {
  const hit = cache.get(supabaseId);
  return hit && hit.expires > Date.now() ? hit.value : undefined;
}

export function setCachedLanding(supabaseId: string, value: string): void {
  if (cache.size >= MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(supabaseId, { value, expires: Date.now() + TTL_MS });
}

/** Drop a user's cached landing page after they change it via PUT, so the
 *  next `/` hit re-reads the new value instead of the stale TTL entry. */
export function invalidateLandingCache(supabaseId: string): void {
  cache.delete(supabaseId);
}
