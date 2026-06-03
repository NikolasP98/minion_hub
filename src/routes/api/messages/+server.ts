import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import { listMessages } from '$server/services/messages.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);

  const rows = await listMessages(ctx.tenantId, {
    channel: url.searchParams.get('channel') ?? undefined,
    chatId: url.searchParams.get('chatId') ?? undefined,
    accountId: url.searchParams.get('accountId') ?? undefined,
    agentId: url.searchParams.get('agentId') ?? undefined,
    since: num('since'),
    until: num('until'),
    limit: num('limit'),
    offset: num('offset'),
  });

  return json({ messages: rows });
};
