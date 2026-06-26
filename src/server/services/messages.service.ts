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

const ON_CONFLICT = {
  target: messages.clientId,
  set: {
    agentId: sql`excluded.agent_id`,
    sessionKey: sql`excluded.session_key`,
    success: sql`excluded.success`,
    error: sql`excluded.error`,
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
export async function insertMessages(
  orgId: string,
  gatewayId: string | null,
  rows: IngestRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => toInsertValues(r, orgId, gatewayId));
  try {
    await withOrg(orgId, async (tx) => {
      await tx.insert(messages).values(values).onConflictDoUpdate(ON_CONFLICT);
    });
    return values.length;
  } catch (bulkErr) {
    let accepted = 0;
    await withOrg(orgId, async (tx) => {
      for (const v of values) {
        try {
          // Nested tx = SAVEPOINT: a failed row rolls back to the savepoint and
          // leaves the outer transaction usable for the rest of the batch.
          await tx.transaction(async (sp) => {
            await sp.insert(messages).values(v).onConflictDoUpdate(ON_CONFLICT);
          });
          accepted += 1;
        } catch (rowErr) {
          console.warn(
            `[ingest] dropping unpersistable message client_id=${v.clientId}: ${String(rowErr)}`,
          );
        }
      }
    });
    console.warn(
      `[ingest] bulk insert failed (${String(bulkErr)}); per-row fallback accepted ${accepted}/${values.length}`,
    );
    return accepted;
  }
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
