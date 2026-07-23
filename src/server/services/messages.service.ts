import { and, eq, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import { messages } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { withOrg } from '$server/db/pg-ledger-client';
import { enqueueWhatsAppBrainChanges } from './brain-corpus-jobs.service';

/** Cache tags for message-ledger reads (omnichat conversations/threads). */
const messageTags = (orgId: string) => tags.tenantDomain(orgId, 'messages');

/** Bust cached ledger reads after a write. Never lets a cache error fail ingest. */
async function bustMessageCaches(orgId: string): Promise<void> {
  try {
    await invalidateTags([...messageTags(orgId)]);
  } catch (cause) {
    console.warn('[messages] cache invalidation failed (stale until TTL)', cause);
  }
}

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
  brainJobId: string | null;
}

export interface MessageIngestStats {
  persisted: number;
  latestPersistedAt: number | null;
}

export type MessageInsert = typeof messages.$inferInsert;

/** Postgres drivers may return timestamp aggregates as Date, ISO text, or epoch numbers. */
export function toTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

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

export function acceptedIngestRows(rows: IngestRow[], acceptedClientIds: string[]): IngestRow[] {
  const accepted = new Set(acceptedClientIds);
  return rows.filter((row) => accepted.has(row.clientId));
}

async function enqueueBrainChangesAfterCommit(
  orgId: string,
  rows: IngestRow[],
  acceptedClientIds: string[],
): Promise<string | null> {
  try {
    return await enqueueWhatsAppBrainChanges(orgId, acceptedIngestRows(rows, acceptedClientIds));
  } catch (cause) {
    // The ledger commit already succeeded. Never return a false ingest failure
    // to the gateway (which would replay the batch); durable reconciliation is
    // the repair path if queue insertion is temporarily unavailable.
    console.error('[brain-corpus] post-commit enqueue failed; reconcile will repair', cause);
    return null;
  }
}

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
  if (rows.length === 0) return { accepted: 0, acceptedClientIds: [], brainJobId: null };
  const values = rows.map((r) => toInsertValues(r, orgId, gatewayId));
  try {
    await withOrg(orgId, async (tx) => {
      await tx.insert(messages).values(values).onConflictDoUpdate(ON_CONFLICT);
    });
    const result = {
      accepted: values.length,
      acceptedClientIds: values.map((value) => value.clientId),
    };
    await bustMessageCaches(orgId);
    const brainJobId = await enqueueBrainChangesAfterCommit(orgId, rows, result.acceptedClientIds);
    return { ...result, brainJobId };
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
    if (acceptedClientIds.length > 0) await bustMessageCaches(orgId);
    const brainJobId = await enqueueBrainChangesAfterCommit(orgId, rows, acceptedClientIds);
    return { accepted: acceptedClientIds.length, acceptedClientIds, brainJobId };
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
    gatewayId?: string;
    channel: string;
    accountId: string;
    since?: number;
  },
): Promise<MessageIngestStats> {
  const conds: SQL[] = [
    eq(messages.orgId, orgId),
    eq(messages.channel, filters.channel),
    eq(messages.accountId, filters.accountId),
  ];
  if (filters.gatewayId !== undefined) conds.push(eq(messages.gatewayId, filters.gatewayId));
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
      latestPersistedAt: toTimestampMs(row?.latestPersistedAt),
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

export interface RecentConversation {
  channel: string;
  chatId: string;
  accountId: string | null;
  isGroup: boolean | null;
  direction: 'inbound' | 'outbound';
  content: string | null;
  occurredAt: number | null;
  /** Latest known counterparty name (from the last named inbound message). */
  senderName: string | null;
  senderHandle: string | null;
}

interface RecentConversationRow {
  channel: string;
  chat_id: string;
  account_id: string | null;
  is_group: boolean | null;
  direction: 'inbound' | 'outbound';
  content: string | null;
  occurred_at: unknown;
  sender_name: string | null;
  sender_handle: string | null;
}

/**
 * Most recent conversation threads across ALL channels: the latest message per
 * (channel, chat_id), newest first. The counterparty name comes from the last
 * named INBOUND message (the latest row may be ours, whose sender is us).
 *
 * Cached per page: ingest/send bust the tag, so the TTL only bounds staleness
 * when invalidation can't reach this instance (memory backend on serverless).
 */
export async function listRecentConversations(
  orgId: string,
  limit = 25,
  offset = 0,
): Promise<RecentConversation[]> {
  return cached(
    keys.hub('omnichat-convos', { t: orgId, d: { n: limit, o: offset } }),
    { ttl: '2m', swr: '30s', tags: [...messageTags(orgId)] },
    () => loadRecentConversations(orgId, limit, offset),
  );
}

/**
 * Perf shape (measured on prod, 270k rows): GROUP BY over an INDEX-ONLY scan of
 * messages_org_chat_idx picks the page of thread keys (~100ms warm), then two
 * lateral index probes per page row fetch the latest message + last named
 * inbound sender. The previous DISTINCT ON over full wide rows spilled a 10MB
 * disk sort (~14s cold). Index-only depends on a healthy visibility map —
 * autovacuum keeps it; a stale one shows up as Heap Fetches in EXPLAIN.
 */
async function loadRecentConversations(
  orgId: string,
  limit: number,
  offset: number,
): Promise<RecentConversation[]> {
  return withOrg(orgId, async (tx) => {
    const rows = (await tx.execute(sql`
      with threads as (
        select channel, chat_id, max(occurred_at) as last_at
        from messages
        where org_id = ${orgId} and chat_id is not null
        group by channel, chat_id
        order by max(occurred_at) desc nulls last
        limit ${Math.min(limit, 100)} offset ${Math.max(offset, 0)}
      )
      select t.channel, t.chat_id, t.last_at as occurred_at,
             l.account_id, l.is_group, l.direction, l.content,
             n.sender_name, n.sender_handle
      from threads t
      left join lateral (
        -- Last message WITH text: media/attachment rows are stored with empty
        -- content (IG polling can't fetch them), useless as a snippet.
        select account_id, is_group, direction, content from messages m
        where m.org_id = ${orgId} and m.channel = t.channel and m.chat_id = t.chat_id
          and m.content is not null and m.content <> ''
        order by m.occurred_at desc nulls last limit 1
      ) l on true
      left join lateral (
        select sender_name, sender_handle from messages m
        where m.org_id = ${orgId} and m.channel = t.channel and m.chat_id = t.chat_id
          and m.direction = 'inbound' and m.sender_name is not null
        order by m.occurred_at desc nulls last limit 1
      ) n on true
      order by t.last_at desc nulls last
    `)) as unknown as RecentConversationRow[];
    return rows.map((r) => ({
      channel: r.channel,
      chatId: r.chat_id,
      accountId: r.account_id,
      isGroup: r.is_group,
      // A thread whose every message is empty (all-media) yields no lateral row.
      direction: r.direction ?? 'inbound',
      content: r.content,
      occurredAt: toTimestampMs(r.occurred_at),
      senderName: r.sender_name,
      senderHandle: r.sender_handle,
    }));
  });
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

export type LedgerMessage = typeof messages.$inferSelect;

/**
 * One conversation's recent messages (newest first), cached under the same tag
 * as the conversation list so any ingest/send refreshes both.
 */
export async function listThreadMessages(
  orgId: string,
  channel: string,
  chatId: string,
  limit = 60,
): Promise<LedgerMessage[]> {
  return cached(
    keys.hub('omnichat-thread', { t: orgId, d: { c: channel, id: chatId, n: limit } }),
    { ttl: '2m', swr: '30s', tags: [...messageTags(orgId)] },
    () => listMessages(orgId, { channel, chatId, limit }),
  );
}
