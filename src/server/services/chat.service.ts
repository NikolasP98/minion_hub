import { eq, and, asc, lt } from 'drizzle-orm';
import { chatMessages } from '@minion-stack/db/pg';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { resolveGatewayId } from '$server/services/gateway.pg.service';

export interface ChatMessageInput {
  serverId: string;
  agentId: string;
  sessionKey: string;
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  timestamp: number;
}

// pg keys on gateway_id, id is bigserial, timestamps are Date. This service
// keeps the Turso-era public shape (serverId echoed, epoch-number timestamps).
type ChatRow = typeof chatMessages.$inferSelect;

function reshape(row: ChatRow, serverId: string) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId,
    agentId: row.agentId,
    sessionKey: row.sessionKey,
    role: row.role,
    content: row.content,
    runId: row.runId,
    timestamp: row.timestamp.getTime(),
    createdAt: row.createdAt.getTime(),
  };
}

export async function insertChatMessage(ctx: CoreCtx, msg: ChatMessageInput) {
  const gatewayId = await resolveGatewayId(msg.serverId);
  if (!gatewayId) throw new Error(`No gateway found for server ${msg.serverId}`);
  await withOrgCore(ctx, (tx) =>
    tx.insert(chatMessages).values({
      tenantId: ctx.tenantId,
      gatewayId,
      agentId: msg.agentId,
      sessionKey: msg.sessionKey,
      role: msg.role,
      content: msg.content,
      runId: msg.runId ?? null,
      timestamp: new Date(msg.timestamp),
    }),
  );
}

export async function listChatMessages(ctx: CoreCtx, agentId: string, limit = 200) {
  // Keyed by agent_id + tenant_id (no gateway scope) — matches the Turso query.
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        role: chatMessages.role,
        content: chatMessages.content,
        runId: chatMessages.runId,
        timestamp: chatMessages.timestamp,
      })
      .from(chatMessages)
      .where(and(eq(chatMessages.agentId, agentId), eq(chatMessages.tenantId, ctx.tenantId)))
      .orderBy(asc(chatMessages.timestamp))
      .limit(limit),
  );
  return rows.map((r) => ({
    role: r.role,
    content: r.content,
    runId: r.runId,
    timestamp: r.timestamp.getTime(),
  }));
}

export async function listChatMessagesBySessionKey(
  ctx: CoreCtx,
  serverId: string,
  sessionKey: string,
  limit = 2000,
) {
  const gatewayId = await resolveGatewayId(serverId);
  if (!gatewayId) return [];
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.gatewayId, gatewayId),
          eq(chatMessages.sessionKey, sessionKey),
          eq(chatMessages.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(asc(chatMessages.timestamp))
      .limit(limit),
  );
  return rows.map((r) => reshape(r, serverId));
}

export async function bulkInsertChatMessages(ctx: CoreCtx, messages: ChatMessageInput[]) {
  if (messages.length === 0) return;
  // Resolve gateway ids outside the txn (resolveGatewayId reads non-RLS/global
  // tables on ctx.db); skip messages with no gateway as before.
  const resolved: { gatewayId: string; msg: ChatMessageInput }[] = [];
  for (const msg of messages) {
    const gatewayId = await resolveGatewayId(msg.serverId);
    if (!gatewayId) continue;
    resolved.push({ gatewayId, msg });
  }
  if (resolved.length === 0) return;
  const rows = resolved.map(({ gatewayId, msg }) => ({
    tenantId: ctx.tenantId,
    gatewayId,
    agentId: msg.agentId,
    sessionKey: msg.sessionKey,
    role: msg.role,
    content: msg.content,
    runId: msg.runId ?? null,
    timestamp: new Date(msg.timestamp),
  }));
  await withOrgCore(ctx, (tx) => tx.insert(chatMessages).values(rows).onConflictDoNothing());
}

/**
 * Prune chat messages older than `olderThan` (epoch ms) for this org. chat_messages
 * is an unbounded append-only transcript; this caps its growth. Mirrors
 * pruneOldActivityBins (same absolute-timestamp arg style). Org-scoped via
 * withOrgCore so the chat_messages RLS policy enforces isolation server-side.
 */
export async function pruneOldChatMessages(ctx: CoreCtx, olderThan: number): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.tenantId, ctx.tenantId),
          lt(chatMessages.timestamp, new Date(olderThan)),
        ),
      ),
  );
}
