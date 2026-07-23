import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { isGatewayChannel } from '$server/services/gateway.pg.service';
import { revalidateChannelLease } from '$server/services/gateway-lease.service';

/**
 * Re-probe and (if needed) flip the `(org, channel)` lease — spec §F2/§F4.
 *
 * Called by the browser when a WS connect fails, and by the lease tick. This is
 * the ONLY path that opens a probe socket; the page-load resolver is DB-only so
 * navigation never pays for a network round trip.
 *
 * The response deliberately carries `stateMoved: false` (§F7): a flip restores
 * SERVICE, not SESSIONS. The org's WhatsApp/Baileys pairing stays on the old
 * host, and the UI must say so rather than presenting a clean recovery.
 *
 * Fail closed: the channel is resolved against the caller's ACTIVE org, so
 * asking for a channel the org has no row for returns 404, not a lease.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  if (!orgId) return json({ error: 'no active organization' }, { status: 400 });

  let body: { channel?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json body' }, { status: 400 });
  }
  if (!isGatewayChannel(body.channel)) {
    return json({ error: "channel must be 'dev' or 'prd'" }, { status: 400 });
  }

  const endpoint = await revalidateChannelLease(orgId, body.channel);
  if (!endpoint) return json({ error: 'Not found' }, { status: 404 });
  // `url`/`name` are intentionally omitted: the client keys by serverId and
  // fetches the URL from its host list, and the token still comes only from
  // /api/servers/[id]/token.
  return json({
    channel: endpoint.channel,
    serverId: endpoint.serverId,
    healthy: endpoint.healthy,
    stateMoved: endpoint.stateMoved,
  });
};
