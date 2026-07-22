import { createHash, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  brainSources,
  brains,
  knowledgeSources,
  type Brain,
  type KnowledgeSource,
} from '$server/db/pg-schema/brains';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { embedTexts, embeddingsEnabled, toVectorLiteral } from './embeddings';
import type { AccessPrincipal } from './brains.service';

export const KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-small';
export const WHATSAPP_CONNECTOR = 'whatsapp';
export const WHATSAPP_FOCUSED_BRAIN_NAME = 'WhatsApp Conversations';
const DEFAULT_CONVERSATION_BATCH = 50;
const DEFAULT_CHUNK_MAX_CHARS = 6000;
const EMBEDDING_BATCH_SIZE = 64;

export type BrainKind = 'master' | 'focused';

export interface WhatsAppConversationCursor {
  accountId: string;
  chatId: string;
}

export interface WhatsAppMessageInput {
  id: string;
  messageId: string | null;
  direction: string;
  content: string;
  senderId: string | null;
  senderName: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface NormalizedKnowledgeChunk {
  chunkKey: string;
  kind: 'raw';
  seq: number;
  chunkText: string;
  contextPrefix: string;
  contentHash: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

export interface NormalizedWhatsAppDocument {
  externalId: string;
  title: string;
  rawText: string;
  normalizedText: string;
  contentHash: string;
  sourceRevision: string;
  occurredAt: Date;
  sourceUpdatedAt: Date;
  metadata: Record<string, unknown>;
  chunks: NormalizedKnowledgeChunk[];
}

export interface WhatsAppConversationKey extends WhatsAppConversationCursor {
  sourceId: string;
}

export interface WhatsAppBackfillResult {
  processed: number;
  changedDocuments: number;
  changedChunks: number;
  embeddedChunks: number;
  unchangedChunks: number;
  deletedChunks: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface WhatsAppReconcileResult {
  deletedDocuments: number;
  deletedChunks: number;
}

export interface BrainKnowledgeStats {
  sourceCount: number;
  documentCount: number;
  chunkCount: number;
  pendingCount: number;
  failedSourceCount: number;
}

export interface BrainConnectorStats {
  connector: string;
  sourceCount: number;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface BrainKnowledgeStatsDTO extends Omit<Brain, 'kind'> {
  kind: BrainKind;
  includeAllSources: boolean;
  stats: BrainKnowledgeStats;
  connectors: BrainConnectorStats[];
  lastSyncedAt: string | null;
}

export interface BrainKnowledgeSourceDTO {
  id: string;
  name: string;
  connector: string;
  externalKey: string;
  status: string;
  syncMode: string;
  cadence: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  documentCount: number;
  chunkCount: number;
  pendingCount: number;
  weight: number | null;
  member: boolean;
}

export interface BrainKnowledgeOverviewDTO {
  brain: BrainKnowledgeStatsDTO;
  stats: BrainKnowledgeStats;
  sources: BrainKnowledgeSourceDTO[];
  connectors: BrainConnectorStats[];
}

interface SourceAggregateRow {
  brain_id: string;
  source_id: string;
  name: string;
  connector: string;
  external_key: string;
  status: string;
  sync_mode: string;
  cadence: string | null;
  last_synced_at: Date | string | null;
  last_error: string | null;
  weight: number | string | null;
  member: boolean;
  document_count: number | string;
  chunk_count: number | string;
  pending_count: number | string;
}

interface ExistingDocumentRow {
  id: string;
  source_id: string;
  external_id: string;
  content_hash: string;
}

interface ExistingChunkRow {
  document_id: string;
  chunk_key: string;
  content_hash: string;
  embedding_model: string | null;
  has_embedding: boolean;
}

interface PreparedConversation {
  key: WhatsAppConversationKey;
  documentId: string;
  document: NormalizedWhatsAppDocument;
  changedDocument: boolean;
  changedChunkKeys: Set<string>;
  staleChunkKeys: string[];
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function knowledgeContentHash(input: string): string {
  return sha256(input.replace(/\r\n?/g, '\n'));
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = asDate(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function roleFor(direction: string): 'Customer' | 'Agent' {
  return direction === 'inbound' ? 'Customer' : 'Agent';
}

function splitLongTurn(turn: string, maxChars: number): string[] {
  if (turn.length <= maxChars) return [turn];
  const out: string[] = [];
  for (let start = 0; start < turn.length; start += maxChars) {
    out.push(turn.slice(start, start + maxChars));
  }
  return out;
}

/**
 * Deterministic turn-aware WhatsApp normalizer. SQL removes duplicate stable
 * message IDs before this runs; the defensive map also makes the pure helper
 * safe for callers/tests that pass duplicate rows directly.
 */
export function normalizeWhatsAppConversation(
  accountId: string,
  chatId: string,
  inputRows: WhatsAppMessageInput[],
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedWhatsAppDocument {
  const rows = [...inputRows]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
    .filter((row, index, all) => {
      if (!row.messageId) return true;
      return all.findIndex((candidate) => candidate.messageId === row.messageId) === index;
    });
  if (rows.length === 0) throw new Error('cannot normalize an empty WhatsApp conversation');

  const rawTurns = rows.map((row) => `${roleFor(row.direction)}: ${row.content.trim()}`);
  const normalizedTurns = rows.map(
    (row) => `${roleFor(row.direction)}: ${normalizeBody(row.content)}`,
  );
  const rawText = rawTurns.join('\n');
  const normalizedText = normalizedTurns.join('\n');
  const contextPrefix = `WhatsApp account ${accountId}; conversation ${chatId}`;
  const occurredAt = rows.at(-1)!.occurredAt;
  const sourceUpdatedAt = rows.reduce(
    (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
    rows[0].createdAt,
  );
  const sourceRevision = sha256(
    rows
      .map((row) => `${row.messageId ?? `row:${row.id}`}\u0000${normalizeBody(row.content)}`)
      .join('\u0001'),
  );

  const grouped: string[] = [];
  let current = '';
  for (const normalizedTurn of normalizedTurns) {
    for (const turn of splitLongTurn(normalizedTurn, maxChars)) {
      const candidate = current ? `${current}\n${turn}` : turn;
      if (current && candidate.length > maxChars) {
        grouped.push(current);
        current = turn;
      } else {
        current = candidate;
      }
    }
  }
  if (current) grouped.push(current);

  const chunks = grouped.map((chunkText, seq): NormalizedKnowledgeChunk => ({
    chunkKey: `raw:${String(seq).padStart(6, '0')}`,
    kind: 'raw',
    seq,
    chunkText,
    contextPrefix,
    contentHash: knowledgeContentHash(`${contextPrefix}\n\n${chunkText}`),
    occurredAt,
    metadata: { channel: 'whatsapp', accountId, chatId, messageCount: rows.length },
  }));

  return {
    externalId: `conversation:${chatId}`,
    title: `WhatsApp · ${chatId}`,
    rawText,
    normalizedText,
    contentHash: knowledgeContentHash(normalizedText),
    sourceRevision,
    occurredAt,
    sourceUpdatedAt,
    metadata: {
      channel: 'whatsapp',
      accountId,
      chatId,
      messageCount: rows.length,
      firstOccurredAt: rows[0].occurredAt.toISOString(),
      lastOccurredAt: occurredAt.toISOString(),
      participants: Array.from(
        new Set(
          rows
            .flatMap((row) => [row.senderId, row.senderName])
            .filter((v): v is string => Boolean(v)),
        ),
      ),
    },
    chunks,
  };
}

export function encodeWhatsAppCursor(cursor: WhatsAppConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeWhatsAppCursor(cursor?: string | null): WhatsAppConversationCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof value.accountId !== 'string' || typeof value.chatId !== 'string') return null;
    return { accountId: value.accountId, chatId: value.chatId };
  } catch {
    return null;
  }
}

export async function ensureMasterBrain(ctx: CoreCtx, createdBy?: string | null): Promise<Brain> {
  return withOrgCore(ctx, async (tx) => {
    await tx
      .insert(brains)
      .values({
        orgId: ctx.tenantId,
        name: 'Master Brain',
        description: 'Organization-wide knowledge from every enabled source.',
        icon: 'brain',
        visibility: 'org',
        kind: 'master',
        includeAllSources: true,
        createdBy: createdBy ?? null,
      })
      .onConflictDoNothing();
    const [brain] = await tx
      .select()
      .from(brains)
      .where(and(eq(brains.orgId, ctx.tenantId), eq(brains.kind, 'master')))
      .limit(1);
    if (!brain) throw new Error(`failed to ensure Master Brain for org ${ctx.tenantId}`);
    return brain;
  });
}

/** Discover one deterministic source for each WhatsApp account in the ledger. */
export async function discoverWhatsAppSources(ctx: CoreCtx): Promise<KnowledgeSource[]> {
  return withOrgCore(ctx, async (tx) => {
    const accounts = (await tx.execute(sql`
      select trim(account_id) as account_id,
        count(distinct chat_id) filter (
          where nullif(trim(chat_id), '') is not null
            and coalesce(is_group, false) = false
            and is_bot is not true
            and nullif(trim(content), '') is not null
        )::int as conversation_count
      from messages
      where org_id = current_setting('app.current_org_id', true)
        and channel = 'whatsapp'
        and nullif(trim(account_id), '') is not null
      group by trim(account_id)
      order by trim(account_id)
    `)) as unknown as Array<{ account_id: string; conversation_count: number }>;
    if (accounts.length === 0) return [];

    const values = sql.join(
      accounts.map(
        ({ account_id, conversation_count }) => sql`(
        current_setting('app.current_org_id', true), ${WHATSAPP_CONNECTOR}, ${account_id},
        ${`WhatsApp ${account_id}`},
        ${JSON.stringify({ channel: 'whatsapp', accountId: account_id })}::jsonb,
        'discovered', 'incremental', 'event+reconcile',
        ${JSON.stringify({ expectedDocuments: Number(conversation_count) })}::jsonb
      )`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      insert into knowledge_sources
        (org_id, connector, external_key, name, config, status, sync_mode, cadence, watermark)
      values ${values}
      on conflict (org_id, connector, external_key) do update set
        name = excluded.name,
        config = excluded.config,
        sync_mode = excluded.sync_mode,
        cadence = excluded.cadence,
        watermark = knowledge_sources.watermark || excluded.watermark,
        status = case
          when knowledge_sources.status in ('failed', 'degraded', 'processing')
            then knowledge_sources.status
          when coalesce((excluded.watermark->>'expectedDocuments')::int, 0) > (
            select count(*)::int from knowledge_documents document
            where document.org_id = excluded.org_id and document.source_id = knowledge_sources.id
              and document.status <> 'deleted'
          ) then 'queued'
          else knowledge_sources.status
        end,
        updated_at = now()
    `);
    return tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.orgId, ctx.tenantId),
          eq(knowledgeSources.connector, WHATSAPP_CONNECTOR),
        ),
      )
      .orderBy(asc(knowledgeSources.externalKey));
  });
}

export async function ensureWhatsAppFocusedBrain(
  ctx: CoreCtx,
  sourceIds: string[],
  createdBy?: string | null,
): Promise<Brain | null> {
  if (sourceIds.length === 0) return null;
  return withOrgCore(ctx, async (tx) => {
    let [brain] = await tx
      .select()
      .from(brains)
      .where(
        and(
          eq(brains.orgId, ctx.tenantId),
          eq(brains.kind, 'focused'),
          eq(brains.name, WHATSAPP_FOCUSED_BRAIN_NAME),
        ),
      )
      .orderBy(asc(brains.createdAt))
      .limit(1);
    if (!brain) {
      [brain] = await tx
        .insert(brains)
        .values({
          orgId: ctx.tenantId,
          name: WHATSAPP_FOCUSED_BRAIN_NAME,
          description: 'Customer conversations from connected WhatsApp accounts.',
          icon: 'message-circle',
          visibility: 'org',
          kind: 'focused',
          includeAllSources: false,
          createdBy: createdBy ?? null,
        })
        .returning();
    }
    await tx
      .insert(brainSources)
      .values(sourceIds.map((sourceId) => ({ brainId: brain.id, orgId: ctx.tenantId, sourceId })))
      .onConflictDoNothing();
    return brain;
  });
}

async function scanWhatsAppKeys(
  tx: CoreTx,
  sourceByAccount: Map<string, string>,
  cursor: WhatsAppConversationCursor | null,
  limit: number,
): Promise<{ keys: WhatsAppConversationKey[]; hasMore: boolean }> {
  if (sourceByAccount.size === 0) return { keys: [], hasMore: false };
  const accounts = [...sourceByAccount.keys()];
  const cursorFilter = cursor
    ? sql`and (m.account_id, m.chat_id) > (${cursor.accountId}, ${cursor.chatId})`
    : sql``;
  const rows = (await tx.execute(sql`
    select m.account_id, m.chat_id
    from messages m
    where m.org_id = current_setting('app.current_org_id', true)
      and m.channel = 'whatsapp'
      and m.account_id = any(${textArray(accounts)})
      and nullif(trim(m.chat_id), '') is not null
      and coalesce(m.is_group, false) = false
      and m.is_bot is not true
      and nullif(trim(m.content), '') is not null
      ${cursorFilter}
    group by m.account_id, m.chat_id
    order by m.account_id, m.chat_id
    limit ${limit + 1}
  `)) as unknown as Array<{ account_id: string; chat_id: string }>;
  const hasMore = rows.length > limit;
  return {
    keys: rows.slice(0, limit).map((row) => ({
      accountId: row.account_id,
      chatId: row.chat_id,
      sourceId: sourceByAccount.get(row.account_id)!,
    })),
    hasMore,
  };
}

function keyValues(keys: WhatsAppConversationKey[]) {
  return sql.join(
    keys.map((key) => sql`(${key.accountId}::text, ${key.chatId}::text)`),
    sql`, `,
  );
}

function textArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::text[]`;
}

function uuidArray(values: string[]) {
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::uuid[]`;
}

async function loadWhatsAppRows(
  tx: CoreTx,
  keys: WhatsAppConversationKey[],
): Promise<Map<string, WhatsAppMessageInput[]>> {
  const out = new Map<string, WhatsAppMessageInput[]>();
  if (keys.length === 0) return out;
  const rows = (await tx.execute(sql`
    select account_id, chat_id, id::text as id, message_id, direction, content,
      sender_id, sender_name, occurred_at, created_at
    from (
      select distinct on (
        m.account_id, m.chat_id, coalesce(nullif(m.message_id, ''), 'row:' || m.id::text)
      ) m.*
      from messages m
      where m.org_id = current_setting('app.current_org_id', true)
        and m.channel = 'whatsapp'
        and coalesce(m.is_group, false) = false
        and m.is_bot is not true
        and nullif(trim(m.content), '') is not null
        and (m.account_id, m.chat_id) in (${keyValues(keys)})
      order by m.account_id, m.chat_id,
        coalesce(nullif(m.message_id, ''), 'row:' || m.id::text),
        coalesce(m.occurred_at, m.created_at), m.id
    ) deduped
    order by account_id, chat_id, coalesce(occurred_at, created_at), id
  `)) as unknown as Array<{
    account_id: string;
    chat_id: string;
    id: string;
    message_id: string | null;
    direction: string;
    content: string;
    sender_id: string | null;
    sender_name: string | null;
    occurred_at: Date | string | null;
    created_at: Date | string;
  }>;
  for (const row of rows) {
    const key = `${row.account_id}\u0000${row.chat_id}`;
    const values = out.get(key) ?? [];
    const createdAt = asDate(row.created_at);
    values.push({
      id: row.id,
      messageId: row.message_id,
      direction: row.direction,
      content: row.content,
      senderId: row.sender_id,
      senderName: row.sender_name,
      occurredAt: row.occurred_at ? asDate(row.occurred_at) : createdAt,
      createdAt,
    });
    out.set(key, values);
  }
  return out;
}

async function prepareConversations(
  tx: CoreTx,
  keys: WhatsAppConversationKey[],
): Promise<PreparedConversation[]> {
  const rowsByKey = await loadWhatsAppRows(tx, keys);
  const normalized = keys
    .map((key) => {
      const rows = rowsByKey.get(`${key.accountId}\u0000${key.chatId}`) ?? [];
      return rows.length > 0
        ? { key, document: normalizeWhatsAppConversation(key.accountId, key.chatId, rows) }
        : null;
    })
    .filter(
      (row): row is { key: WhatsAppConversationKey; document: NormalizedWhatsAppDocument } =>
        row !== null,
    );
  if (normalized.length === 0) return [];

  const docPairs = sql.join(
    normalized.map(
      ({ key, document }) => sql`(${key.sourceId}::uuid, ${document.externalId}::text)`,
    ),
    sql`, `,
  );
  const oldDocs = (await tx.execute(sql`
    select id::text, source_id::text, external_id, content_hash
    from knowledge_documents
    where org_id = current_setting('app.current_org_id', true)
      and (source_id, external_id) in (${docPairs})
  `)) as unknown as ExistingDocumentRow[];
  const oldDocByKey = new Map(
    oldDocs.map((doc) => [`${doc.source_id}\u0000${doc.external_id}`, doc]),
  );
  const docIds = oldDocs.map((doc) => doc.id);
  const oldChunks =
    docIds.length === 0
      ? []
      : ((await tx.execute(sql`
        select document_id::text, chunk_key, content_hash, embedding_model,
          (embedding is not null) as has_embedding
        from knowledge_chunks
        where org_id = current_setting('app.current_org_id', true)
          and document_id = any(${uuidArray(docIds)})
      `)) as unknown as ExistingChunkRow[]);
  const chunksByDocument = new Map<string, ExistingChunkRow[]>();
  for (const chunk of oldChunks) {
    const values = chunksByDocument.get(chunk.document_id) ?? [];
    values.push(chunk);
    chunksByDocument.set(chunk.document_id, values);
  }

  return normalized.map(({ key, document }) => {
    const oldDoc = oldDocByKey.get(`${key.sourceId}\u0000${document.externalId}`);
    const documentId = oldDoc?.id ?? randomUUID();
    const oldByKey = new Map(
      (chunksByDocument.get(documentId) ?? []).map((chunk) => [chunk.chunk_key, chunk]),
    );
    const changedChunkKeys = new Set(
      document.chunks
        .filter((chunk) => {
          const old = oldByKey.get(chunk.chunkKey);
          return (
            !old ||
            old.content_hash !== chunk.contentHash ||
            !old.has_embedding ||
            old.embedding_model !== KNOWLEDGE_EMBEDDING_MODEL
          );
        })
        .map((chunk) => chunk.chunkKey),
    );
    const nextKeys = new Set(document.chunks.map((chunk) => chunk.chunkKey));
    return {
      key,
      documentId,
      document,
      changedDocument: !oldDoc || oldDoc.content_hash !== document.contentHash,
      changedChunkKeys,
      staleChunkKeys: [...oldByKey.keys()].filter((chunkKey) => !nextKeys.has(chunkKey)),
    };
  });
}

async function embedChangedChunks(
  prepared: PreparedConversation[],
): Promise<Map<string, number[]>> {
  const changed = prepared.flatMap((conversation) =>
    conversation.document.chunks
      .filter((chunk) => conversation.changedChunkKeys.has(chunk.chunkKey))
      .map((chunk) => ({
        key: `${conversation.documentId}\u0000${chunk.chunkKey}`,
        text: `${chunk.contextPrefix}\n\n${chunk.chunkText}`,
      })),
  );
  const out = new Map<string, number[]>();
  if (changed.length === 0 || !embeddingsEnabled()) return out;
  for (let i = 0; i < changed.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = changed.slice(i, i + EMBEDDING_BATCH_SIZE);
    const vectors = await embedTexts(batch.map((item) => item.text));
    batch.forEach((item, index) => out.set(item.key, vectors[index]));
  }
  return out;
}

async function persistConversations(
  ctx: CoreCtx,
  prepared: PreparedConversation[],
  vectors: Map<string, number[]>,
): Promise<{ deletedChunks: number }> {
  if (prepared.length === 0) return { deletedChunks: 0 };
  return withOrgCore(ctx, async (tx) => {
    let deletedChunks = 0;
    for (const conversation of prepared) {
      const { document, documentId, key } = conversation;
      const allChangedEmbedded = [...conversation.changedChunkKeys].every((chunkKey) =>
        vectors.has(`${documentId}\u0000${chunkKey}`),
      );
      const documentStatus =
        conversation.changedChunkKeys.size > 0 && !allChangedEmbedded ? 'pending' : 'ready';
      await tx.execute(sql`
        insert into knowledge_documents
          (id, org_id, source_id, external_id, title, raw_text, normalized_text,
           content_hash, source_revision, occurred_at, source_updated_at,
           ingested_at, status, metadata, updated_at)
        values (
          ${documentId}::uuid, current_setting('app.current_org_id', true), ${key.sourceId}::uuid,
          ${document.externalId}, ${document.title}, ${document.rawText}, ${document.normalizedText},
          ${document.contentHash}, ${document.sourceRevision}, ${document.occurredAt.toISOString()}::timestamptz,
          ${document.sourceUpdatedAt.toISOString()}::timestamptz, now(), ${documentStatus},
          ${JSON.stringify(document.metadata)}::jsonb, now()
        )
        on conflict (org_id, source_id, external_id) do update set
          title = excluded.title,
          raw_text = excluded.raw_text,
          normalized_text = excluded.normalized_text,
          content_hash = excluded.content_hash,
          source_revision = excluded.source_revision,
          occurred_at = excluded.occurred_at,
          source_updated_at = excluded.source_updated_at,
          ingested_at = excluded.ingested_at,
          status = excluded.status,
          metadata = excluded.metadata,
          updated_at = excluded.updated_at
      `);

      for (const chunk of document.chunks) {
        const vector = vectors.get(`${documentId}\u0000${chunk.chunkKey}`);
        const vectorSql = vector ? sql`${toVectorLiteral(vector)}::vector` : sql`null`;
        const model = vector ? KNOWLEDGE_EMBEDDING_MODEL : null;
        await tx.execute(sql`
          insert into knowledge_chunks
            (org_id, source_id, document_id, chunk_key, kind, seq, chunk_text,
             context_prefix, content_hash, embedding, embedding_model, occurred_at, metadata, updated_at)
          values (
            current_setting('app.current_org_id', true), ${key.sourceId}::uuid, ${documentId}::uuid,
            ${chunk.chunkKey}, ${chunk.kind}, ${chunk.seq}, ${chunk.chunkText}, ${chunk.contextPrefix},
            ${chunk.contentHash}, ${vectorSql}, ${model}, ${chunk.occurredAt.toISOString()}::timestamptz,
            ${JSON.stringify(chunk.metadata)}::jsonb, now()
          )
          on conflict (org_id, document_id, chunk_key) do update set
            source_id = excluded.source_id,
            kind = excluded.kind,
            seq = excluded.seq,
            chunk_text = excluded.chunk_text,
            context_prefix = excluded.context_prefix,
            embedding = case
              when knowledge_chunks.content_hash = excluded.content_hash
                then coalesce(excluded.embedding, knowledge_chunks.embedding)
              else excluded.embedding
            end,
            embedding_model = case
              when knowledge_chunks.content_hash = excluded.content_hash
                then coalesce(excluded.embedding_model, knowledge_chunks.embedding_model)
              else excluded.embedding_model
            end,
            content_hash = excluded.content_hash,
            occurred_at = excluded.occurred_at,
            metadata = excluded.metadata,
            updated_at = excluded.updated_at
        `);
      }
      if (conversation.staleChunkKeys.length > 0) {
        const deleted = (await tx.execute(sql`
          delete from knowledge_chunks
          where org_id = current_setting('app.current_org_id', true)
            and document_id = ${documentId}::uuid
            and chunk_key = any(${textArray(conversation.staleChunkKeys)})
          returning id
        `)) as unknown as Array<{ id: string }>;
        deletedChunks += deleted.length;
      }
    }

    const sourceIds = Array.from(new Set(prepared.map((item) => item.key.sourceId)));
    await tx.execute(sql`
      update knowledge_sources
      set status = case
            when coalesce((watermark->>'expectedDocuments')::int, 0) > (
              select count(*)::int from knowledge_documents document
              where document.org_id = knowledge_sources.org_id
                and document.source_id = knowledge_sources.id and document.status <> 'deleted'
            ) then 'queued'
            when exists (
              select 1 from knowledge_chunks chunk
              where chunk.org_id = knowledge_sources.org_id
                and chunk.source_id = knowledge_sources.id and chunk.embedding is null
            ) then 'queued'
            else 'ready'
          end,
          last_synced_at = now(), last_error = null, updated_at = now()
      where org_id = current_setting('app.current_org_id', true)
        and id = any(${uuidArray(sourceIds)})
    `);
    return { deletedChunks };
  });
}

async function runPreparedBatch(
  ctx: CoreCtx,
  prepared: PreparedConversation[],
): Promise<Omit<WhatsAppBackfillResult, 'nextCursor' | 'hasMore'>> {
  const changedChunks = prepared.reduce((sum, row) => sum + row.changedChunkKeys.size, 0);
  const unchangedChunks = prepared.reduce(
    (sum, row) => sum + row.document.chunks.length - row.changedChunkKeys.size,
    0,
  );
  let vectors: Map<string, number[]>;
  try {
    vectors = await embedChangedChunks(prepared);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Embedding failed';
    const sourceIds = Array.from(new Set(prepared.map((item) => item.key.sourceId)));
    await withOrgCore(ctx, (tx) =>
      tx.execute(sql`
      update knowledge_sources
      set status = 'failed', last_error = ${message.slice(0, 1000)}, updated_at = now()
      where org_id = current_setting('app.current_org_id', true)
        and id = any(${uuidArray(sourceIds)})
    `),
    );
    throw cause;
  }
  const { deletedChunks } = await persistConversations(ctx, prepared, vectors);
  return {
    processed: prepared.length,
    changedDocuments: prepared.filter((row) => row.changedDocument).length,
    changedChunks,
    embeddedChunks: vectors.size,
    unchangedChunks,
    deletedChunks,
  };
}

/**
 * Full-scan safety net for deletions/missed hooks. Documents become tombstones
 * so their stable identity is retained, while their chunks are removed from
 * retrieval. A later reappearance revives the document through the normal
 * upsert path.
 */
export async function reconcileDeletedWhatsAppDocuments(
  ctx: CoreCtx,
  only?: { accountId: string; chatId: string },
): Promise<WhatsAppReconcileResult> {
  return withOrgCore(ctx, async (tx) => {
    const specific = only
      ? sql`and source.external_key = ${only.accountId}
            and document.metadata->>'chatId' = ${only.chatId}`
      : sql``;
    const tombstones = (await tx.execute(sql`
      update knowledge_documents document
      set status = 'deleted', ingested_at = now(), updated_at = now()
      from knowledge_sources source
      where document.org_id = current_setting('app.current_org_id', true)
        and source.org_id = document.org_id and source.id = document.source_id
        and source.connector = ${WHATSAPP_CONNECTOR}
        and document.status <> 'deleted'
        ${specific}
        and not exists (
          select 1 from messages message
          where message.org_id = document.org_id
            and message.channel = 'whatsapp'
            and message.account_id = source.external_key
            and message.chat_id = document.metadata->>'chatId'
            and coalesce(message.is_group, false) = false
            and message.is_bot is not true
            and nullif(trim(message.content), '') is not null
        )
      returning document.id::text
    `)) as unknown as Array<{ id: string }>;
    if (tombstones.length === 0) return { deletedDocuments: 0, deletedChunks: 0 };
    const documentIds = tombstones.map((row) => row.id);
    const chunks = (await tx.execute(sql`
      delete from knowledge_chunks
      where org_id = current_setting('app.current_org_id', true)
        and document_id = any(${uuidArray(documentIds)})
      returning id
    `)) as unknown as Array<{ id: string }>;
    return { deletedDocuments: tombstones.length, deletedChunks: chunks.length };
  });
}

/** Cursor-driven full/catch-up page. Re-running from the start is idempotent. */
export async function backfillWhatsAppConversations(
  ctx: CoreCtx,
  opts?: { cursor?: string | null; limit?: number },
): Promise<WhatsAppBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? DEFAULT_CONVERSATION_BATCH)));
  const sources = await discoverWhatsAppSources(ctx);
  const sourceByAccount = new Map(sources.map((source) => [source.externalKey, source.id]));
  const cursor = decodeWhatsAppCursor(opts?.cursor);
  const preparedPage = await withOrgCore(ctx, async (tx) => {
    const page = await scanWhatsAppKeys(tx, sourceByAccount, cursor, limit);
    return { ...page, prepared: await prepareConversations(tx, page.keys) };
  });
  const counts = await runPreparedBatch(ctx, preparedPage.prepared);
  const last = preparedPage.keys.at(-1) ?? null;
  const reconciled = preparedPage.hasMore
    ? { deletedDocuments: 0, deletedChunks: 0 }
    : await reconcileDeletedWhatsAppDocuments(ctx);
  return {
    ...counts,
    deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
    nextCursor:
      preparedPage.hasMore && last
        ? encodeWhatsAppCursor({ accountId: last.accountId, chatId: last.chatId })
        : null,
    hasMore: preparedPage.hasMore,
  };
}

/** Event-hook target: rebuild exactly one account-scoped conversation. */
export async function syncWhatsAppConversation(
  ctx: CoreCtx,
  accountId: string,
  chatId: string,
): Promise<WhatsAppBackfillResult> {
  const sources = await discoverWhatsAppSources(ctx);
  const source = sources.find((row) => row.externalKey === accountId);
  if (!source) {
    return {
      processed: 0,
      changedDocuments: 0,
      changedChunks: 0,
      embeddedChunks: 0,
      unchangedChunks: 0,
      deletedChunks: 0,
      nextCursor: null,
      hasMore: false,
    };
  }
  const key = { accountId, chatId, sourceId: source.id };
  const prepared = await withOrgCore(ctx, (tx) => prepareConversations(tx, [key]));
  if (prepared.length === 0) {
    const reconciled = await reconcileDeletedWhatsAppDocuments(ctx, { accountId, chatId });
    return {
      processed: 0,
      changedDocuments: 0,
      changedChunks: 0,
      embeddedChunks: 0,
      unchangedChunks: 0,
      deletedChunks: reconciled.deletedChunks,
      nextCursor: null,
      hasMore: false,
    };
  }
  return { ...(await runPreparedBatch(ctx, prepared)), nextCursor: null, hasMore: false };
}

export async function bootstrapBrainCorpus(
  ctx: CoreCtx,
  opts?: { createdBy?: string | null; cursor?: string | null; limit?: number },
): Promise<{
  masterBrain: Brain;
  focusedBrain: Brain | null;
  sources: KnowledgeSource[];
  backfill: WhatsAppBackfillResult;
}> {
  const masterBrain = await ensureMasterBrain(ctx, opts?.createdBy);
  const sources = await discoverWhatsAppSources(ctx);
  const focusedBrain = await ensureWhatsAppFocusedBrain(
    ctx,
    sources.map((source) => source.id),
    opts?.createdBy,
  );
  const backfill = await backfillWhatsAppConversations(ctx, {
    cursor: opts?.cursor,
    limit: opts?.limit,
  });
  return { masterBrain, focusedBrain, sources, backfill };
}

function emptyStats(): BrainKnowledgeStats {
  return { sourceCount: 0, documentCount: 0, chunkCount: 0, pendingCount: 0, failedSourceCount: 0 };
}

function connectorStatus(statuses: string[]): string {
  for (const candidate of ['failed', 'degraded', 'processing', 'queued', 'discovered', 'ready']) {
    if (statuses.includes(candidate)) return candidate;
  }
  return 'discovered';
}

async function loadSourceAggregates(
  ctx: CoreCtx,
  requested: Brain[],
): Promise<SourceAggregateRow[]> {
  if (requested.length === 0) return [];
  const values = sql.join(
    requested.map((brain) => sql`(${brain.id}::uuid, ${brain.includeAllSources}::boolean)`),
    sql`, `,
  );
  return withOrgCore(
    ctx,
    async (tx) =>
      (await tx.execute(sql`
    with requested(brain_id, include_all_sources) as (values ${values})
    select requested.brain_id::text,
      source.id::text as source_id, source.name, source.connector,
      source.external_key, source.status, source.sync_mode, source.cadence,
      source.last_synced_at, source.last_error, membership.weight,
      (requested.include_all_sources or membership.source_id is not null) as member,
      coalesce(counts.document_count, 0)::int as document_count,
      coalesce(counts.chunk_count, 0)::int as chunk_count,
      (
        coalesce(counts.pending_count, 0)
        + greatest(
            coalesce((source.watermark->>'expectedDocuments')::int, 0)
              - coalesce(counts.document_count, 0),
            0
          )
      )::int as pending_count
    from requested
    cross join knowledge_sources source
    left join brain_sources membership
      on membership.org_id = current_setting('app.current_org_id', true)
      and membership.brain_id = requested.brain_id and membership.source_id = source.id
    left join lateral (
      select count(distinct document.id)::int as document_count,
        count(chunk.id)::int as chunk_count,
        (
          count(chunk.id) filter (where chunk.embedding is null)
          + count(distinct document.id) filter (
              where document.status in ('pending', 'processing', 'failed') and chunk.id is null
            )
        )::int as pending_count
      from knowledge_documents document
      left join knowledge_chunks chunk
        on chunk.org_id = document.org_id and chunk.document_id = document.id
      where document.org_id = current_setting('app.current_org_id', true)
        and document.source_id = source.id and document.status <> 'deleted'
    ) counts on true
    where source.org_id = current_setting('app.current_org_id', true)
    order by requested.brain_id, source.connector, source.name, source.id
  `)) as unknown as SourceAggregateRow[],
  );
}

function aggregateBrain(brain: Brain, rows: SourceAggregateRow[]): BrainKnowledgeStatsDTO {
  const memberRows = rows.filter((row) => row.member);
  const stats = memberRows.reduce<BrainKnowledgeStats>(
    (sum, row) => ({
      sourceCount: sum.sourceCount + 1,
      documentCount: sum.documentCount + Number(row.document_count),
      chunkCount: sum.chunkCount + Number(row.chunk_count),
      pendingCount: sum.pendingCount + Number(row.pending_count),
      failedSourceCount: sum.failedSourceCount + (row.status === 'failed' ? 1 : 0),
    }),
    emptyStats(),
  );
  const connectorMap = new Map<string, SourceAggregateRow[]>();
  for (const row of memberRows) {
    const values = connectorMap.get(row.connector) ?? [];
    values.push(row);
    connectorMap.set(row.connector, values);
  }
  const connectors = [...connectorMap.entries()].map(([connector, sourceRows]) => {
    const dates = sourceRows
      .map((row) => asIso(row.last_synced_at))
      .filter((v): v is string => v !== null);
    return {
      connector,
      sourceCount: sourceRows.length,
      status: connectorStatus(sourceRows.map((row) => row.status)),
      lastSyncedAt: dates.sort().at(-1) ?? null,
      lastError: sourceRows.find((row) => row.last_error)?.last_error ?? null,
    };
  });
  const allDates = connectors
    .map((connector) => connector.lastSyncedAt)
    .filter((v): v is string => v !== null);
  return {
    ...brain,
    kind: brain.kind === 'master' ? 'master' : 'focused',
    includeAllSources: brain.includeAllSources,
    stats,
    connectors,
    lastSyncedAt: allDates.sort().at(-1) ?? null,
  };
}

export async function listBrainsWithKnowledgeStats(
  ctx: CoreCtx,
  principal: AccessPrincipal,
): Promise<BrainKnowledgeStatsDTO[]> {
  const { listBrains } = await import('./brains.service');
  const rows = await listBrains(ctx, principal);
  const sourceRows = await loadSourceAggregates(ctx, rows);
  return rows
    .map((brain) =>
      aggregateBrain(
        brain,
        sourceRows.filter((row) => row.brain_id === brain.id),
      ),
    )
    .sort((a, b) => Number(b.kind === 'master') - Number(a.kind === 'master'));
}

export async function getBrainKnowledgeOverview(
  ctx: CoreCtx,
  brainId: string,
  principal: AccessPrincipal,
): Promise<BrainKnowledgeOverviewDTO> {
  const { getBrain } = await import('./brains.service');
  const rawBrain = await getBrain(ctx, brainId, principal);
  if (!rawBrain) throw error(404, 'Brain not found');
  const rows = await loadSourceAggregates(ctx, [rawBrain]);
  const brain = aggregateBrain(rawBrain, rows);
  const sources = rows.map((row): BrainKnowledgeSourceDTO => ({
    id: row.source_id,
    name: row.name,
    connector: row.connector,
    externalKey: row.external_key,
    status: row.status,
    syncMode: row.sync_mode,
    cadence: row.cadence,
    lastSyncedAt: asIso(row.last_synced_at),
    lastError: row.last_error,
    documentCount: Number(row.document_count),
    chunkCount: Number(row.chunk_count),
    pendingCount: Number(row.pending_count),
    weight: row.weight === null ? null : Number(row.weight),
    member: row.member,
  }));
  return { brain, stats: brain.stats, sources, connectors: brain.connectors };
}
