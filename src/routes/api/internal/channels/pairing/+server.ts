import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import {
  listPairingRequests,
  upsertPairingRequest,
  type PairingScope,
} from '$server/services/channel-pairing.service';

/**
 * Internal gateway→hub channel pairing store (DB-backed replacement for the gateway's
 * <channel>-pairing.json). Same gateway-Bearer auth as /api/internal/channels/resolved:
 * locals.serverId is set ONLY for that bearer, so requiring it keeps this gateway-only.
 * Under /api/internal/* which hooks.server.ts gate-bypasses.
 *
 *   GET  ?channelType=&accountId=          → { requests: [{id, senderId, codeHash, meta, ...}] }
 *   POST { channelType, accountId, senderId, codeHash, meta? } → { created }
 */

async function gatewayScope(
  locals: App.Locals,
  channelType: unknown,
  accountId: unknown,
): Promise<PairingScope> {
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!locals.tenantCtx || !serverId) throw error(401, 'Unauthorized');
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) throw error(401, 'Unknown gateway');
  if (typeof channelType !== 'string' || !channelType) throw error(400, 'channelType required');
  if (typeof accountId !== 'string' || !accountId) throw error(400, 'accountId required');
  return { gatewayId, channelType, accountId };
}

export const GET: RequestHandler = async ({ locals, url }) => {
  const scope = await gatewayScope(
    locals,
    url.searchParams.get('channelType'),
    url.searchParams.get('accountId'),
  );
  return json({ requests: await listPairingRequests(scope) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = await gatewayScope(locals, body.channelType, body.accountId);
  if (typeof body.senderId !== 'string' || !body.senderId) throw error(400, 'senderId required');
  if (typeof body.codeHash !== 'string' || !body.codeHash) throw error(400, 'codeHash required');
  const meta =
    body.meta && typeof body.meta === 'object' ? (body.meta as Record<string, unknown>) : {};
  const result = await upsertPairingRequest(scope, {
    senderId: body.senderId,
    codeHash: body.codeHash,
    meta,
  });
  return json(result);
};
