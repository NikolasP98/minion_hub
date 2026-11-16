import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {
  listChatMessagesBySessionKey,
  bulkInsertChatMessages,
} from '$server/services/chat.service';
import type { ChatMessageInput } from '$server/services/chat.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { assertCanAccessStoredSession } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);

  const sessionKey = decodeURIComponent(params.sessionKey!);
  await assertCanAccessStoredSession(locals, { sessionKey });
  const messages = await listChatMessagesBySessionKey(ctx, params.id!, sessionKey);
  return json({ messages });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);

  const body = await request.json();
  const incoming: unknown[] = Array.isArray(body.messages) ? body.messages : [];

  const sessionKey = decodeURIComponent(params.sessionKey!);
  await assertCanAccessStoredSession(locals, { sessionKey });
  // chat-history reads rows by agent id: a member may not file rows under another agent.
  for (const agentId of new Set(
    incoming.map((m) => (m as { agentId?: unknown } | null)?.agentId),
  )) {
    if (typeof agentId === 'string') await assertCanAccessStoredSession(locals, { agentId });
  }
  const serverId = params.id!;

  const messages: ChatMessageInput[] = incoming
    .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object')
    .filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        (typeof m.content === 'string' || Array.isArray(m.content)),
    )
    .map((m) => {
      const content =
        typeof m.content === 'string'
          ? m.content
          : (m.content as Array<{ type?: string; text?: string }>)
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('');
      return {
        serverId,
        agentId: typeof m.agentId === 'string' ? m.agentId : 'default',
        sessionKey,
        role: m.role as 'user' | 'assistant',
        content,
        runId: typeof m.runId === 'string' ? m.runId : undefined,
        timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
      };
    })
    .filter((m) => m.content.length > 0);

  await bulkInsertChatMessages(ctx, messages);
  return json({ ok: true, count: messages.length });
};
