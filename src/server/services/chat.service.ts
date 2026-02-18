import { eq, and, asc } from 'drizzle-orm';
import { chatMessages } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface ChatMessageInput {
  serverId: string;
  agentId: string;
  sessionKey: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  timestamp: number;
}

export async function insertChatMessage(ctx: TenantContext, msg: ChatMessageInput) {
  await ctx.db.insert(chatMessages).values({
    tenantId: ctx.tenantId,
    serverId: msg.serverId,
    agentId: msg.agentId,
    sessionKey: msg.sessionKey,
    role: msg.role,
    content: msg.content,
    runId: msg.runId ?? null,
    timestamp: msg.timestamp,
    createdAt: nowMs(),
  });
}

export async function listChatMessages(
  ctx: TenantContext,
  agentId: string,
  limit = 200,
) {
  return ctx.db
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      runId: chatMessages.runId,
      timestamp: chatMessages.timestamp,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.agentId, agentId), eq(chatMessages.tenantId, ctx.tenantId)))
    .orderBy(asc(chatMessages.timestamp))
    .limit(limit);
}
