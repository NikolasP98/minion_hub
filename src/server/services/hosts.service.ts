import { listGatewayHostsForUser, type UserHostRow } from './gateway.pg.service';
import type { LoadCtx } from './types';

export interface HostsLoadResult {
  servers: UserHostRow[];
  authoritative: true;
  /** Host id (legacy server id) of the gateway currently ASSIGNED to the
   * caller's active org — per-org volume tenancy spec §3.4: `gateway.org_id`
   * is a mutable assignment (lease read-model), not ownership. Null when the
   * org has no assignment (shared-pool default = today's behavior). The client
   * uses it as the default `activeHostId` absent a manual selection. */
  orgAssignedHostId: string | null;
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
  const locals = ctx as App.Locals;
  const profileId = locals.user?.supabaseId ?? null;
  const servers = await listGatewayHostsForUser(profileId, isAdmin);
  // Active org → assigned gateway (if it's among the user's visible hosts).
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  const orgAssignedHostId = orgId
    ? (servers.find((s) => s.orgId === orgId)?.id ?? null)
    : null;
  return { servers, authoritative: true, orgAssignedHostId };
}
