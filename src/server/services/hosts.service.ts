import { listServers } from './server.service';
import type { LoadCtx } from './types';

export interface HostsLoadResult {
  servers: Awaited<ReturnType<typeof listServers>>;
  authoritative: true;
}

/**
 * Load the host list as seen by the given user. Mirrors `GET /api/servers`
 * on the success path: returns `{ servers, authoritative: true }`.
 *
 * Per-user scoping is delegated to `listServers`:
 *   - anonymous → []
 *   - non-admin → only linked hosts
 *   - admin → all in tenant
 *
 * If no tenant has been seeded yet, returns an authoritative empty list
 * (same as the existing endpoint's "no org seeded yet" branch).
 *
 * Note: this helper does NOT swallow `listServers` errors. The
 * non-authoritative error response (HTTP 500 with `{ ok:false, error }`)
 * lives in the `+server.ts` wrapper because it is HTTP-specific. Callers
 * from `+layout.server.ts` should decide their own error policy.
 */
export async function loadHostsForUser(
  ctx: LoadCtx,
  userId: string | undefined,
  userRole: string | undefined,
): Promise<HostsLoadResult> {
  const { getTenantCtx } = await import('$server/auth/tenant-ctx');
  const tenantCtx = await getTenantCtx(ctx as App.Locals);
  if (!tenantCtx) {
    return { servers: [], authoritative: true };
  }
  const servers = await listServers(tenantCtx, userId, userRole);
  return { servers, authoritative: true };
}
