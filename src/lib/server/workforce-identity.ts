import { mintIdentity, type IdentityClaims } from '@minion-stack/workforce-client/identity-jwt';
import { env } from '$env/dynamic/private';
import { canonicalizeWorkforceRoleKeys, workforceIdentityCacheKey } from './workforce-role-keys';

type RoleAwareIdentityClaims = IdentityClaims & { roleKeys: string[] };

const TOKEN_TTL_SECONDS = 300;
// Re-mint 50s before the 300s TTL lapses so a cached token never reaches the
// proxy already-expired.
const CACHE_TTL_MS = (TOKEN_TTL_SECONDS - 50) * 1000;
// ponytail: bound the in-process cache at 1000 (userId, companyId, role-set) entries —
// far above the live concurrent-user count, FIFO-evict the oldest at capacity
// so this can't leak. Per-instance only; tokens are stateless JWTs.
const MAX_ENTRIES = 1000;

const tokenCache = new Map<string, { token: string; expires: number }>();

/**
 * Mint a workforce identity JWT, memoized per (userId, companyId, role-set). hooks.server
 * mints one on EVERY request under /workforce, /api/workforce, /api/pc — these
 * are high-frequency catch-all proxy routes — so caching collapses the repeated
 * sign work to a Map lookup until just before the token's TTL.
 */
export async function mintWorkforceIdentity(claims: RoleAwareIdentityClaims): Promise<string> {
  // HUB_WORKFORCE_SHARED_SECRET is canonical; HUB_PAPERCLIP_SHARED_SECRET is a
  // compat fallback during the paperclip→workforce rename.
  const secret = env.HUB_WORKFORCE_SHARED_SECRET ?? env.HUB_PAPERCLIP_SHARED_SECRET;
  if (!secret) throw new Error('HUB_WORKFORCE_SHARED_SECRET not set');

  const roleKeys = canonicalizeWorkforceRoleKeys(claims.roleKeys);
  // email/name aren't authorization-relevant and shouldn't fragment the cache;
  // a stale display name in the token is harmless and clears within ~250s.
  const key = workforceIdentityCacheKey({ ...claims, roleKeys });
  const now = Date.now();
  const hit = tokenCache.get(key);
  if (hit && hit.expires > now) return hit.token;

  // The currently installed package type predates roleKeys, but mintIdentity
  // signs the complete claims object. The package upgrade makes this field
  // first-class without changing this call site.
  const signedClaims: RoleAwareIdentityClaims = { ...claims, roleKeys };
  const token = await mintIdentity({ secret, claims: signedClaims, ttlSeconds: TOKEN_TTL_SECONDS });
  if (tokenCache.size >= MAX_ENTRIES) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, { token, expires: now + CACHE_TTL_MS });
  return token;
}
