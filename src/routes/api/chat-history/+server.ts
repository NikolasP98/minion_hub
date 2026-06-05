import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listChatMessages } from '$server/services/chat.service';
import { requireCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await requireCoreCtx(locals);
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
