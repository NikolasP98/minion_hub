import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { messages } from '@minion-stack/db/pg';
import { withOrg } from '$server/db/pg-ledger-client';

export interface IngestRow {
  clientId: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  accountId: string | null;
  chatId: string | null;
  isGroup: boolean | null;
  senderId: string | null;
  senderName: string | null;
  senderHandle: string | null;
  isBot: boolean | null;
  content: string | null;
  messageId: string | null;
  agentId: string | null;
  sessionKey: string | null;
  success: boolean | null;
  error: string | null;
  occurredAt: number | null;
  metadata: Record<string, unknown>;
}

export interface RoutingPatch {
  clientId: string;
  agentId: string | null;
  sessionKey: string;
}

export type MessageInsert = typeof messages.$inferInsert;

/** Pure mapping from an ingest row → Drizzle insert values (testable without a DB). */
export function toInsertValues(row: IngestRow, orgId: string, gatewayId: string | null): MessageInsert {
  return {
    clientId: row.clientId,
    orgId,
    gatewayId: gatewayId ?? null,
    direction: row.direction,
    channel: row.channel,
    accountId: row.accountId,
    chatId: row.chatId,
    isGroup: row.isGroup,
    senderId: row.senderId,
    senderName: row.senderName,
    senderHandle: row.senderHandle,
    isBot: row.isBot,
    content: row.content,
    messageId: row.messageId,
    agentId: row.agentId,
    sessionKey: row.sessionKey,
    success: row.success,
    error: row.error,
    occurredAt: typeof row.occurredAt === 'number' ? new Date(row.occurredAt) : null,
    metadata: row.metadata ?? {},
  };
}

/** Insert ingested rows; idempotent on client_id. */
export async function insertMessages(
  orgId: string,
  gatewayId: string | null,
  rows: IngestRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => toInsertValues(r, orgId, gatewayId));
  await withOrg(orgId, async (tx) => {
    await tx
      .insert(messages)
      .values(values)
      .onConflictDoUpdate({
        target: messages.clientId,
        set: {
          agentId: sql`excluded.agent_id`,
          sessionKey: sql`excluded.session_key`,
          success: sql`excluded.success`,
          error: sql`excluded.error`,
        },
      });
  });
  return values.length;
}

/** Apply late routing backfills, keyed by client_id. */
export async function applyRoutingPatches(orgId: string, patches: RoutingPatch[]): Promise<void> {
  if (patches.length === 0) return;
  await withOrg(orgId, async (tx) => {
    for (const p of patches) {
      await tx
        .update(messages)
        .set({ agentId: p.agentId, sessionKey: p.sessionKey })
        .where(eq(messages.clientId, p.clientId));
    }
  });
}

export interface ListFilters {
  channel?: string;
  chatId?: string;
  accountId?: string;
  agentId?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

/** List messages for an org (RLS also enforces org isolation as a backstop). */
export async function listMessages(orgId: string, filters: ListFilters) {
  return withOrg(orgId, async (tx) => {
    const conds: SQL[] = [eq(messages.orgId, orgId)];
    if (filters.channel) conds.push(eq(messages.channel, filters.channel));
    if (filters.chatId) conds.push(eq(messages.chatId, filters.chatId));
    if (filters.accountId) conds.push(eq(messages.accountId, filters.accountId));
    if (filters.agentId) conds.push(eq(messages.agentId, filters.agentId));
    if (filters.since) conds.push(gte(messages.occurredAt, new Date(filters.since)));
    if (filters.until) conds.push(lte(messages.occurredAt, new Date(filters.until)));
    return tx
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.occurredAt))
      .limit(Math.min(filters.limit ?? 100, 500))
      .offset(filters.offset ?? 0);
  });
}
