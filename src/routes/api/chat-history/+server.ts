import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChatMessages } from '$server/services/chat.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);
  const agentId = url.searchParams.get('agentId');
  const limit = parseInt(url.searchParams.get('limit') ?? '200', 10);

  if (!agentId) return json({ messages: [] });

  try {
    const messages = await listChatMessages(locals.tenantCtx, agentId, limit);
    return json({ messages });
  } catch {
    return json({ messages: [] });
  }
};
