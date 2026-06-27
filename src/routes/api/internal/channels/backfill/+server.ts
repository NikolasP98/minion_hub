import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import { backfillAllGatewayChannels } from '$server/services/channel-sync.service';

/**
 * Internal one-shot ALL-ORGS channel backfill (consensus M4 / P3 mirror completeness).
 * Imports every org's gateway.json accounts into the DB `channels` table in one pass,
 * so the gateway mirror holds all live channels (not just the acting org's).
 *
 * Auth = the SAME gateway metrics Bearer as /api/internal/channels/resolved:
 * `resolveIdentity` sets `locals.serverId` only for that bearer. Gateway-only, so the
 * cross-org write (getCoreDb RLS-bypass) can't be reached by a browser session.
 * Idempotent (upsert) — safe to re-run. DB-only; does not mirror-push to gateway.json.
 */
export const POST: RequestHandler = async ({ locals }) => {
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!locals.tenantCtx || !serverId) throw error(401, 'Unauthorized');
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) throw error(401, 'Unknown gateway');

  const res = await backfillAllGatewayChannels(gatewayId);
  return json({ ok: true, ...res });
};
