import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listChatMessagesBySessionKey, bulkInsertChatMessages } from '$server/services/chat.service';
import type { ChatMessageInput } from '$server/services/chat.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const sessionKey = decodeURIComponent(params.sessionKey!);
  const messages = await listChatMessagesBySessionKey(
    locals.tenantCtx,
    params.id!,
    sessionKey,
  );
  return json({ messages });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const incoming: unknown[] = Array.isArray(body.messages) ? body.messages : [];

  const sessionKey = decodeURIComponent(params.sessionKey!);
  const serverId = params.id!;

  const messages: ChatMessageInput[] = incoming
    .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object')
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      serverId,
      agentId: typeof m.agentId === 'string' ? m.agentId : 'default',
      sessionKey,
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
      runId: typeof m.runId === 'string' ? m.runId : undefined,
      timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
    }));

  await bulkInsertChatMessages(locals.tenantCtx, messages);
  return json({ ok: true, count: messages.length });
};
