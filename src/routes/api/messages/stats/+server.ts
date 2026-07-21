import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { resolveGatewayId } from '$server/services/gateway.pg.service';
import { getMessageIngestStats } from '$server/services/messages.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const serverId = url.searchParams.get('serverId')?.trim();
  const channel = url.searchParams.get('channel')?.trim();
  const accountId = url.searchParams.get('accountId')?.trim();
  const sinceRaw = url.searchParams.get('since');

  if (!serverId || !channel || !accountId) {
    throw error(400, 'serverId, channel, and accountId are required');
  }
  const since = sinceRaw === null ? undefined : Number(sinceRaw);
  if (since !== undefined && (!Number.isFinite(since) || since < 0)) {
    throw error(400, 'since must be a non-negative timestamp');
  }

  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) throw error(404, 'Gateway not found');

  const stats = await getMessageIngestStats(ctx.tenantId, {
    gatewayId,
    channel,
    accountId,
    since,
  });
  return json(stats);
};
