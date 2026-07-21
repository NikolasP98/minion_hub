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

export interface MessageIngestResult {
  accepted: number;
  acceptedClientIds: string[];
}

export interface MessageIngestStats {
  persisted: number;
  latestPersistedAt: number | null;
}

export type MessageInsert = typeof messages.$inferInsert;

/** Pure mapping from an ingest row → Drizzle insert values (testable without a DB). */
export function toInsertValues(
  row: IngestRow,
  orgId: string,
  gatewayId: string | null,
): MessageInsert {
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

export const MESSAGE_CONFLICT_TARGET = [messages.orgId, messages.clientId];

const ON_CONFLICT = {
  target: MESSAGE_CONFLICT_TARGET,
  set: {
    agentId: sql`excluded.agent_id`,
    sessionKey: sql`excluded.session_key`,
    success: sql`excluded.success`,
    error: sql`excluded.error`,
    // Fill-if-null only: lets a re-sync backfill names on rows ingested before
    // the source started sending them, without ever clobbering an existing one.
    senderName: sql`coalesce(${messages.senderName}, excluded.sender_name)`,
  },
} as const;

/**
 * Insert ingested rows; idempotent on client_id.
 *
 * Fast path is one bulk insert. If ANY row is unpersistable (a constraint or
 * encoding error), Postgres aborts the whole statement — which used to 500 the
 * ingest endpoint, so the gateway flusher marked the entire batch failed and
 * retried forever, clogging its outbox behind a single poison row. So on a bulk
 * failure we fall back to per-row inserts (savepoint each) and drop only the
 * rows that can't be stored. Bad rows never block the queue again.
 */
export async function insertMessagesDetailed(
  orgId: string,
  gatewayId: string | null,
  rows: IngestRow[],
): Promise<MessageIngestResult> {
  if (rows.length === 0) return { accepted: 0, acceptedClientIds: [] };
  const values = rows.map((r) => toInsertValues(r, orgId, gatewayId));
  try {
    await withOrg(orgId, async (tx) => {
      await tx.insert(messages).values(values).onConflictDoUpdate(ON_CONFLICT);
    });
    return {
      accepted: values.length,
      acceptedClientIds: values.map((value) => value.clientId),
    };
  } catch (bulkErr) {
    const acceptedClientIds: string[] = [];
    await withOrg(orgId, async (tx) => {
      for (const v of values) {
        try {
          // Nested tx = SAVEPOINT: a failed row rolls back to the savepoint and
          // leaves the outer transaction usable for the rest of the batch.
          await tx.transaction(async (sp) => {
            await sp.insert(messages).values(v).onConflictDoUpdate(ON_CONFLICT);
          });
          acceptedClientIds.push(v.clientId);
        } catch (rowErr) {
          console.warn(
            `[ingest] rejecting unpersistable message client_id=${v.clientId}: ${String(rowErr)}`,
          );
        }
      }
    });
    console.warn(
      `[ingest] bulk insert failed (${String(bulkErr)}); per-row fallback accepted ${acceptedClientIds.length}/${values.length}`,
    );
    return { accepted: acceptedClientIds.length, acceptedClientIds };
  }
}

/** Backward-compatible count-only facade for in-process callers. */
export async function insertMessages(
  orgId: string,
  gatewayId: string | null,
  rows: IngestRow[],
): Promise<number> {
  return (await insertMessagesDetailed(orgId, gatewayId, rows)).accepted;
}

/**
 * Authoritative, post-commit persistence count for one gateway account.
 * `since` scopes the total to the current history-sync session when supplied.
 */
export async function getMessageIngestStats(
  orgId: string,
  filters: {
    gatewayId: string;
    channel: string;
    accountId: string;
    since?: number;
  },
): Promise<MessageIngestStats> {
  const conds: SQL[] = [
    eq(messages.orgId, orgId),
    eq(messages.gatewayId, filters.gatewayId),
    eq(messages.channel, filters.channel),
    eq(messages.accountId, filters.accountId),
  ];
  if (filters.since !== undefined) {
    conds.push(gte(messages.createdAt, new Date(filters.since)));
  }
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({
        persisted: sql<number>`count(*)::int`,
        latestPersistedAt: sql<Date | null>`max(${messages.createdAt})`,
      })
      .from(messages)
      .where(and(...conds));
    return {
      persisted: row?.persisted ?? 0,
      latestPersistedAt: row?.latestPersistedAt?.getTime() ?? null,
    };
  });
}

/** Apply late routing backfills, keyed by client_id. */
export async function applyRoutingPatches(orgId: string, patches: RoutingPatch[]): Promise<void> {
  if (patches.length === 0) return;
  await withOrg(orgId, (tx) => {
    // Single set-based update from an inline VALUES table, keyed on client_id.
    // First row is cast so Postgres infers the column types (agent_id is nullable).
    const rows = sql.join(
      patches.map((p, i) =>
        i === 0
          ? sql`(${p.clientId}::text, ${p.agentId}::text, ${p.sessionKey}::text)`
          : sql`(${p.clientId}, ${p.agentId}, ${p.sessionKey})`,
      ),
      sql`, `,
    );
    return tx.execute(sql`
      update messages m set agent_id = v.agent_id, session_key = v.session_key
      from (values ${rows}) as v(client_id, agent_id, session_key)
      where m.client_id = v.client_id
    `);
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
