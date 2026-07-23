import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { getMessageIngestStats } from '$server/services/messages.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const channel = url.searchParams.get('channel')?.trim();
  const accountId = url.searchParams.get('accountId')?.trim();
  const sinceRaw = url.searchParams.get('since');

  if (!channel || !accountId) {
    throw error(400, 'channel and accountId are required');
  }
  const since = sinceRaw === null ? undefined : Number(sinceRaw);
  if (since !== undefined && (!Number.isFinite(since) || since < 0)) {
    throw error(400, 'since must be a non-negative timestamp');
  }

  // Durable confirmation is account-scoped inside the authenticated org and
  // current sync window. The browser's selected host id is deliberately not
  // part of the key: host ids can be aliases or stale records even while the
  // live socket is connected to the correct gateway. client_id idempotency is
  // already org-scoped, so counting across gateway aliases cannot double-count.
  const stats = await getMessageIngestStats(ctx.tenantId, {
    channel,
    accountId,
    since,
  });
  return json(stats);
};
