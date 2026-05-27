import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listChatMessages } from '$server/services/chat.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = requireTenantCtx(locals);
  const agentId = url.searchParams.get('agentId');
  const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

  if (!agentId) return json({ messages: [] });

  try {
    const messages = await listChatMessages(ctx, agentId, limit);
    return json({ messages });
  } catch {
    return json({ messages: [] });
  }
};
