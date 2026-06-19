import { listGatewayHostsForUser, type UserHostRow } from './gateway.pg.service';
import type { LoadCtx } from './types';

export interface HostsLoadResult {
  servers: UserHostRow[];
  authoritative: true;
}

/**
 * Load the host list as seen by the given user. Mirrors `GET /api/servers`
 * on the success path: returns `{ servers, authoritative: true }`.
 *
 * Source of truth = Supabase `gateway`/`user_gateway` keyed by profile uuid.
 * Per-user scoping is delegated to `listGatewayHostsForUser`:
 *   - anonymous → []
 *   - non-admin → only linked hosts
 *   - admin → all in tenant
 *
 * Returns an authoritative empty list when no gateways are seeded.
 */
export async function loadHostsForUser(
  ctx: LoadCtx,
  _userId: string | undefined,
  userRole: string | undefined,
): Promise<HostsLoadResult> {
  const isAdmin = userRole === 'admin';
  const profileId = (ctx as App.Locals).user?.supabaseId ?? null;
  const servers = await listGatewayHostsForUser(profileId, isAdmin);
  return { servers, authoritative: true };
}
