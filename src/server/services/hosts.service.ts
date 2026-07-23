import {
  listGatewayHostsForUser,
  listOrgChannels,
  type GatewayChannel,
  type UserHostRow,
} from './gateway.pg.service';
import { resolveChannelEndpoint } from './gateway-lease.service';
import type { LoadCtx } from './types';

/** What the browser is told about one build channel. Deliberately NOT the
 *  instance identity — the user picks a channel, the lease picks the box. */
export interface ChannelEndpoint {
  channel: GatewayChannel;
  /** Lease-resolved instance, as the legacy server id the client keys by. */
  serverId: string;
  /** Last probe verdict; null = not probed since the lease was taken. */
  healthy: boolean | null;
}

export interface HostsLoadResult {
  servers: UserHostRow[];
  authoritative: true;
  /** Host id (legacy server id) of the gateway currently ASSIGNED to the
   * caller's active org — per-org volume tenancy spec §3.4: `gateway.org_id`
   * is a mutable assignment (lease read-model), not ownership. Null when the
   * org has no assignment (shared-pool default = today's behavior). The client
   * uses it as the default `activeHostId` absent a manual selection. */
  orgAssignedHostId: string | null;
  /** Build channels the ACTIVE ORG has gateway rows for, each already resolved
   * to ONE instance server-side (spec §D4). One entry (FACES) ⇒ the picker is
   * hidden; empty ⇒ the org has no gateways at all. The client picks a channel
   * from this list and connects to the `serverId` we resolved — it never
   * chooses an instance, and a channel absent from this list is unreachable no
   * matter what the client asks for (re-checked in `listChannelCandidates`). */
  channels: ChannelEndpoint[];
  /** Channel to use absent a this-session manual pick. `prd` is the safe
   * default; only an org with a dev row can end up on `dev`. */
  defaultChannel: GatewayChannel | null;
}

/**
 * Load the host list as seen by the given user. Mirrors `GET /api/servers`
 * on the success path: returns `{ servers, authoritative: true }`.
 *
 * Source of truth = Supabase `gateway`/`user_gateway` keyed by profile uuid,
 * scoped to the caller's ACTIVE ORG. `listGatewayHostsForUser` fails closed on
 * a missing org — admins included; admin is not a cross-org escape hatch.
 *
 * Returns an authoritative empty list when the active org has no gateways.
 */
export async function loadHostsForUser(
  ctx: LoadCtx,
  _userId: string | undefined,
  userRole: string | undefined,
): Promise<HostsLoadResult> {
  const isAdmin = userRole === 'admin';
  const locals = ctx as App.Locals;
  const profileId = locals.user?.supabaseId ?? null;
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  const servers = await listGatewayHostsForUser(profileId, isAdmin, orgId);
  // Active org → assigned gateway (if it's among the user's visible hosts).
  const orgAssignedHostId = orgId ? (servers.find((s) => s.orgId === orgId)?.id ?? null) : null;

  // Resolve each of the org's channels to one instance. At most two (an org has
  // at most dev+prd) and no network — `resolveChannelEndpoint` is DB-only by
  // design; the WS probe lives on the failover path, not on every page load.
  const orgChannels = await listOrgChannels(orgId);
  const resolved = await Promise.all(
    orgChannels.map((channel) => resolveChannelEndpoint(orgId, channel)),
  );
  const channels: ChannelEndpoint[] = resolved
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({ channel: r.channel, serverId: r.serverId, healthy: r.healthy }));

  return {
    servers,
    authoritative: true,
    orgAssignedHostId,
    channels,
    defaultChannel:
      channels.find((c) => c.channel === 'prd')?.channel ?? channels[0]?.channel ?? null,
  };
}
