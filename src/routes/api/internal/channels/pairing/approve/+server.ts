import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import { approvePairingRequest } from '$server/services/channel-pairing.service';

/**
 * Approve a pairing request: the gateway has already verified the plaintext code against
 * the stored hash (token-hash.ts) and resolved the sender, so this just adds the sender to
 * channels.allow_from and deletes the pending request. Gateway-Bearer auth (locals.serverId).
 *
 *   POST { channelType, accountId, senderId } → { approved }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const serverId = (locals as Record<string, unknown>).serverId as string | undefined;
  if (!locals.tenantCtx || !serverId) throw error(401, 'Unauthorized');
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) throw error(401, 'Unknown gateway');

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.channelType !== 'string' || !body.channelType)
    throw error(400, 'channelType required');
  if (typeof body.accountId !== 'string' || !body.accountId) throw error(400, 'accountId required');
  if (typeof body.senderId !== 'string' || !body.senderId) throw error(400, 'senderId required');

  const result = await approvePairingRequest(
    { gatewayId, channelType: body.channelType, accountId: body.accountId },
    body.senderId,
  );
  return json(result);
};
