import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { requireTenantCtx } from '$server/auth/authorize';
import {
  listMessages,
  listRecentConversations,
  listThreadMessages,
} from '$server/services/messages.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const num = (k: string) =>
    url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined;
  const view = url.searchParams.get('view');

  // Omnichat dock: latest thread per (channel, chat_id) across all channels.
  if (view === 'conversations') {
    const conversations = await listRecentConversations(
      ctx.tenantId,
      num('limit') ?? 25,
      num('offset') ?? 0,
    );
    return json({ conversations });
  }

  // Omnichat dock: one conversation's messages, cached.
  if (view === 'thread') {
    const channel = url.searchParams.get('channel');
    const chatId = url.searchParams.get('chatId');
    if (!channel || !chatId) throw error(400, 'channel and chatId are required');
    const rows = await listThreadMessages(ctx.tenantId, channel, chatId, num('limit') ?? 60);
    return json({ messages: rows });
  }

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
