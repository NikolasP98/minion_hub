import { createHash, randomUUID } from 'node:crypto';
import { cached, keys, tags } from '@minion-stack/cache';
import { error } from '@sveltejs/kit';
import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  brainSources,
  brains,
  knowledgeSources,
  type Brain,
  type KnowledgeSource,
} from '$server/db/pg-schema/brains';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import {
  embedTexts,
  embeddingsEnabled,
  prepareEmbeddingRequest,
  toVectorLiteral,
} from './embeddings';
import type { AccessPrincipal } from './brains.service';
import type { JobExecution } from './bg-runtime';
import { JobEffectError, jobEffectHeadId, withOwnedJobScope } from './job-effects.service';
import {
  bindJobEffectPage,
  commitJobEffectPage,
  JobEffectPageError,
  runJobPageEmbeddings,
  type LoadedPageSource,
  type PageDomainGuard,
  type PageInput,
} from './job-effect-pages.service';

export const KNOWLEDGE_EMBEDDING_MODEL = 'text-embedding-3-small';
/** Semantic receipt identity: independent of job id, lease and scheduling type. */
export const CONVERSATION_CORPUS_FAMILY = 'brain.corpus.conversation';
const CONVERSATION_CORPUS_PIPELINE = `conversation-corpus-v1/${KNOWLEDGE_EMBEDDING_MODEL}`;
export const WHATSAPP_CONNECTOR = 'whatsapp';
export const LEGACY_WHATSAPP_FOCUSED_BRAIN_NAME = 'WhatsApp Conversations';
export const CONVERSATIONS_FOCUSED_BRAIN_NAME = 'All Conversations';
/** Backward-compatible export for callers that still import the old symbol. */
export const WHATSAPP_FOCUSED_BRAIN_NAME = CONVERSATIONS_FOCUSED_BRAIN_NAME;
const DEFAULT_CONVERSATION_BATCH = 50;
const DEFAULT_CHUNK_MAX_CHARS = 6000;
const DEFAULT_CONTEXT_MAX_CHARS = 6000;
const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_BATCH_CONCURRENCY = Math.min(
  8,
  Math.max(1, Number(process.env.BRAIN_EMBEDDING_BATCH_CONCURRENCY) || 4),
);

/** Qdrant-owned mode keeps canonical text/metadata in Postgres and delegates
 * vector generation to the durable serving-index worker. */
export function qdrantOwnsKnowledgeEmbeddings(): boolean {
  return process.env.BRAIN_VECTOR_STORAGE_MODE === 'qdrant';
}

// ── Job ownership (shared by the conversation and business corpus jobs) ─────

export type CorpusProgress = Record<string, unknown>;

/** Owned execution for a job-triggered corpus call. Established non-job callers
 * omit it and keep their `withOrgCore` transactions; they are not job-fenced. */
export interface CorpusJobContext<Result = unknown> {
  execution: JobExecution;
  /** The job's current canonical cursor: intermediate pages re-commit it unchanged. */
  cursor: CorpusProgress;
  /** Exact progress committed with the final page/deletion/health effects. */
  progress: (result: Result) => CorpusProgress;
}

export type CorpusJobScope = Pick<CorpusJobContext, 'execution'>;

/** A page reservation is held by another live job; retry later without failing. */
export class CorpusPageBusy extends Error {
  readonly code = 'busy';
  constructor(message: string) {
    super(message);
    this.name = 'CorpusPageBusy';
  }
}

/** Ordinary failures keep the existing bounded per-item accounting; every other
 * class must not increment failure counts, write source status or advance progress. */
export function classifyCorpusJobError(
  error: unknown,
): 'busy' | 'fenced' | 'superseded' | 'ordinary' {
  if (error instanceof CorpusPageBusy) return 'busy';
  if (error instanceof JobEffectError || error instanceof JobEffectPageError) {
    if (error.code === 'superseded') return 'superseded';
    if (error.code === 'ownership_lost' || error.code === 'indeterminate') return 'fenced';
    if (error instanceof JobEffectPageError && error.code === 'owner_missing') return 'fenced';
  }
  return 'ordinary';
}

/** Rethrow a fenced outcome with its code in the message so the persisted job
 * error is self-classifying (ownership_lost / indeterminate / owner_missing). */
export function corpusJobFailure(cause: unknown, handler: string): Error {
  if (cause instanceof JobEffectPageError)
    return new JobEffectPageError(cause.code, `${handler} ${cause.code}: ${cause.message}`);
  if (cause instanceof JobEffectError)
    return new JobEffectError(cause.code, `${handler} ${cause.code}: ${cause.message}`);
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** One short tenant-scoped transaction: owned by the current job when a job
 * context is present, otherwise the established `withOrgCore` path. */
export function corpusScope<T>(
  ctx: CoreCtx,
  job: CorpusJobScope | undefined,
  fn: (tx: CoreTx) => Promise<T>,
  nextProgress?: CorpusProgress,
): Promise<T> {
  if (!job) return withOrgCore(ctx, fn);
  return withOwnedJobScope(job.execution, ctx, async (tx) => ({
    value: await fn(tx),
    nextProgress,
  }));
}

export type CorpusEmbeddingPolicy = Pick<
  PageInput,
  'mode' | 'expectedProvider' | 'servingGeneration'
>;

/** Active vector mode is part of the receipt identity. */
export function corpusEmbeddingPolicy(qdrantOwned: boolean): CorpusEmbeddingPolicy {
  if (qdrantOwned) return { mode: 'qdrant', expectedProvider: null, servingGeneration: 'qdrant' };
  if (!embeddingsEnabled())
    return { mode: 'disabled', expectedProvider: null, servingGeneration: null };
  const { endpoint, model, normalization, dimensions } = prepareEmbeddingRequest([
    'corpus-policy',
  ]).descriptor;
  return {
    mode: 'embedded',
    expectedProvider: { endpoint, model, normalization, dimensions },
    servingGeneration: null,
  };
}

export interface CorpusPageItem<T> {
  item: T;
  source: LoadedPageSource;
}

const PAGE_LIMITS = { heads: 64, chunks: 256, chars: 2_097_152 } as const;

/** Greedy split of one prepared corpus page into foundation-sized effect pages.
 * A single source above the limits cannot be embedded through this path. */
export function packCorpusPages<T>(items: CorpusPageItem<T>[]): CorpusPageItem<T>[][] {
  const pages: CorpusPageItem<T>[][] = [];
  let page: CorpusPageItem<T>[] = [];
  let chunks = 0;
  let chars = 0;
  for (const entry of items) {
    const count = entry.source.chunks.length;
    const length = entry.source.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
    // TODO(handoff): a single month segment/business record above the foundation
    // page limits (256 chunks or 2 MiB of chunk text) cannot be embedded through
    // the job path and surfaces as an ordinary bounded failure; the pre-adoption
    // path had no ceiling. Needs a multi-page-per-source manifest decision
    // (job-effect-pages.service LIMIT) before such a source can publish again.
    if (count > PAGE_LIMITS.chunks || length > PAGE_LIMITS.chars)
      throw new JobEffectPageError('capacity', 'Corpus document exceeds one effect page');
    if (
      page.length >= PAGE_LIMITS.heads ||
      chunks + count > PAGE_LIMITS.chunks ||
      chars + length > PAGE_LIMITS.chars
    ) {
      pages.push(page);
      page = [];
      chunks = 0;
      chars = 0;
    }
    page.push(entry);
    chunks += count;
    chars += length;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

export interface CorpusPagePublication<T extends { documentId: string }> {
  pageKeyPrefix: string;
  pipelineVersion: string;
  policy: CorpusEmbeddingPolicy;
  /** Only items that need a write; unchanged documents never bind a head. */
  items: CorpusPageItem<T>[];
  /** Rechecks the observed source snapshot under head/domain locks. */
  validateDomain: PageDomainGuard;
  /** Publishes one effect page's documents/chunks; vectors keyed `${documentId}\0${chunkKey}`. */
  publish: (tx: CoreTx, items: T[], vectors: Map<string, number[]>) => Promise<void>;
  /** Terminal deletion/health effects, committed with the last page and progress. */
  finalize: (tx: CoreTx) => Promise<void>;
  nextProgress: CorpusProgress;
}

/** Bind, embed and publish the prepared items page by page. Every provider
 * call runs outside database transactions through the shared receipt
 * foundation; the last commit also carries `finalize` and the exact progress. */
export async function publishCorpusPages<T extends { documentId: string }>(
  ctx: CoreCtx,
  job: Pick<CorpusJobContext, 'execution' | 'cursor'>,
  publication: CorpusPagePublication<T>,
): Promise<{ embeddedChunks: number }> {
  const { execution } = job;
  const pages = packCorpusPages(publication.items);
  if (pages.length === 0) {
    await corpusScope(ctx, job, publication.finalize, publication.nextProgress);
    return { embeddedChunks: 0 };
  }
  let embeddedChunks = 0;
  for (const [index, page] of pages.entries()) {
    const last = index === pages.length - 1;
    const sources = page.map((entry) => entry.source);
    const pageKey = `${publication.pageKeyPrefix}:${sha256(
      JSON.stringify(
        sources.map((source) => [source.entityId, source.sourceHash, source.requiredChunkKeys]),
      ),
    )}`;
    const handle = await bindJobEffectPage(
      execution,
      ctx,
      { pageKey, pipelineVersion: publication.pipelineVersion, ...publication.policy, sources },
      publication.validateDomain,
    );
    const embedded = await runJobPageEmbeddings(
      execution,
      ctx,
      handle,
      sources,
      publication.validateDomain,
    );
    if (embedded.state === 'busy') {
      // ponytail: brief pause then yield the same cursor; the runtime re-advances.
      await new Promise((resolve) => setTimeout(resolve, 250));
      throw new CorpusPageBusy(`Corpus page reservation is ${embedded.reason}`);
    }
    // Head ids derive from tenant/family/entity and match each value's sourceKey.
    const bySourceKey = new Map(
      page.map((entry) => [jobEffectHeadId(ctx.tenantId, entry.source), entry.item]),
    );
    const committed = await commitJobEffectPage(
      execution,
      ctx,
      handle,
      publication.validateDomain,
      async (tx, _current, values) => {
        const vectors = new Map<string, number[]>();
        for (const value of values) {
          const item = bySourceKey.get(value.sourceKey);
          if (!item) throw new JobEffectPageError('conflict', 'Published vector has no document');
          vectors.set(`${item.documentId}\u0000${value.chunkKey}`, [...value.vector]);
        }
        await publication.publish(tx, [...bySourceKey.values()], vectors);
        if (last) await publication.finalize(tx);
        return vectors.size;
      },
      last ? publication.nextProgress : job.cursor,
    );
    embeddedChunks += committed.replayed
      ? sources.reduce((sum, source) => sum + source.requiredChunkKeys.length, 0)
      : committed.value;
  }
  return { embeddedChunks };
}

export type BrainKind = 'master' | 'focused';

export interface WhatsAppConversationCursor {
  accountId: string;
  chatId: string;
}

export interface ConversationCursor extends WhatsAppConversationCursor {
  channel: string;
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

/** Exactly what renderConversationRelationshipContext and the document
 * metadata consume — no PII (phone/email/document) is joined or carried. */
export interface ConversationRelationshipContext {
  contact: {
    id: string;
    humanId: string | null;
    displayName: string | null;
    lifecycleOverride: string | null;
    source: string;
  } | null;
  party: {
    id: string;
    type: string;
    name: string | null;
  } | null;
  identities: Array<{ channel: string }>;
  tags: string[];
  activities: Array<{ kind: string; occurredAt: string }>;
}

export function whatsappCalendarMonth(value: Date): string {
  return value.toISOString().slice(0, 7);
}

export interface WhatsAppConversationKey extends WhatsAppConversationCursor {
  channel: string;
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

export interface BrainSourceMembershipResult {
  sourceId: string;
  member: boolean;
  changed: boolean;
}

interface SourceAggregateRow {
  brain_id: string;
  source_id: string;
  name: string;
  connector: string;
  external_key: string;
  source_config: unknown;
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

/** Mirror retrieval's fail-closed source classification for the Sources UI
 * and membership mutation path. A Focused Brain reference never broadens the
 * caller's underlying module/field access. */
export function canPrincipalSearchKnowledgeSource(
  configValue: unknown,
  principal: AccessPrincipal,
): boolean {
  const config =
    configValue && typeof configValue === 'object' && !Array.isArray(configValue)
      ? (configValue as Record<string, unknown>)
      : {};
  const requiredModule =
    typeof config.requiredModule === 'string' && config.requiredModule.trim()
      ? config.requiredModule.trim()
      : null;
  const rawFieldLevel = config.requiredFieldLevel;
  const parsedFieldLevel = Number(rawFieldLevel ?? 0);
  const requiredFieldLevel =
    rawFieldLevel === undefined ||
    rawFieldLevel === null ||
    rawFieldLevel === '' ||
    (Number.isInteger(parsedFieldLevel) && parsedFieldLevel >= 0)
      ? Math.max(0, parsedFieldLevel)
      : Number.MAX_SAFE_INTEGER;
  if (!requiredModule) return requiredFieldLevel === 0;
  return (
    (principal.searchableModules ?? []).includes(requiredModule) &&
    (principal.fieldLevels?.[requiredModule] ?? 0) >= requiredFieldLevel
  );
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

export function preparedConversationNeedsWrite(value: {
  changedDocument: boolean;
  changedChunkKeys: Set<string>;
  staleChunkKeys: string[];
}): boolean {
  return (
    value.changedDocument || value.changedChunkKeys.size > 0 || value.staleChunkKeys.length > 0
  );
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

function channelLabel(channel: string): string {
  if (channel.toLowerCase() === 'whatsapp') return 'WhatsApp';
  return channel
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function renderConversationRelationshipContext(
  context: ConversationRelationshipContext | null,
): string {
  if (!context?.contact) return 'CRM contact: not matched';
  const lines = [
    `CRM contact: ${context.contact.displayName ?? context.contact.humanId ?? context.contact.id}`,
    `CRM profile: lifecycle=${context.contact.lifecycleOverride ?? 'derived'}; source=${context.contact.source}`,
  ];
  if (context.party) {
    lines.push(`Party: ${context.party.name ?? context.party.id}; type=${context.party.type}`);
  }
  if (context.identities.length > 0) {
    lines.push(
      `Known channels: ${[...new Set(context.identities.map((identity) => identity.channel))].join(', ')}`,
    );
  }
  if (context.tags.length > 0) lines.push(`CRM tags: ${context.tags.join(', ')}`);
  if (context.activities.length > 0) {
    lines.push(
      `Recent CRM activity: ${context.activities
        .map((activity) => `${activity.occurredAt} ${activity.kind}`)
        .join(' | ')}`,
    );
  }
  const rendered = lines.join('\n');
  return rendered.length <= DEFAULT_CONTEXT_MAX_CHARS
    ? rendered
    : `${rendered.slice(0, DEFAULT_CONTEXT_MAX_CHARS - 1)}…`;
}

/**
 * Deterministic turn-aware normalizer for any 1:1 chat channel. SQL removes
 * duplicate stable message IDs before this runs; the defensive map also makes
 * the pure helper safe for callers/tests that pass duplicate rows directly.
 */
export function normalizeConversation(
  channel: string,
  accountId: string,
  chatId: string,
  inputRows: WhatsAppMessageInput[],
  relationshipContext: ConversationRelationshipContext | null = null,
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedWhatsAppDocument {
  const rows = [...inputRows]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id))
    .filter((row, index, all) => {
      if (!row.messageId) return true;
      return all.findIndex((candidate) => candidate.messageId === row.messageId) === index;
    });
  if (rows.length === 0) throw new Error('cannot normalize an empty conversation');

  const rawTurns = rows.map((row) => `${roleFor(row.direction)}: ${row.content.trim()}`);
  const normalizedTurns = rows.map(
    (row) => `${roleFor(row.direction)}: ${normalizeBody(row.content)}`,
  );
  const rawText = rawTurns.join('\n');
  const normalizedText = normalizedTurns.join('\n');
  const segmentMonth = whatsappCalendarMonth(rows[0].occurredAt);
  if (rows.some((row) => whatsappCalendarMonth(row.occurredAt) !== segmentMonth)) {
    throw new Error('normalizeWhatsAppConversation requires rows from one UTC calendar month');
  }
  const label = channelLabel(channel);
  const joinedContext = renderConversationRelationshipContext(relationshipContext);
  const contextPrefix = `${label} account ${accountId}; conversation ${chatId}; month ${segmentMonth}\n${joinedContext}`;
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
    metadata: {
      channel,
      accountId,
      chatId,
      segmentMonth,
      messageCount: rows.length,
      contactId: relationshipContext?.contact?.id ?? null,
      partyId: relationshipContext?.party?.id ?? null,
    },
  }));

  return {
    externalId: `conversation:${accountId}:${chatId}:${segmentMonth}`,
    title: `${label} · ${relationshipContext?.contact?.displayName ?? chatId} · ${segmentMonth}`,
    rawText,
    normalizedText: `${joinedContext}\n\n${normalizedText}`,
    contentHash: knowledgeContentHash(`${joinedContext}\n\n${normalizedText}`),
    sourceRevision: sha256(`${sourceRevision}\u0000${joinedContext}`),
    occurredAt,
    sourceUpdatedAt,
    metadata: {
      channel,
      accountId,
      chatId,
      segmentMonth,
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
      contactId: relationshipContext?.contact?.id ?? null,
      partyId: relationshipContext?.party?.id ?? null,
    },
    chunks,
  };
}

export function normalizeWhatsAppConversation(
  accountId: string,
  chatId: string,
  inputRows: WhatsAppMessageInput[],
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedWhatsAppDocument {
  return normalizeConversation('whatsapp', accountId, chatId, inputRows, null, maxChars);
}

/** Stable UTC-month segments: later or mid-history messages only change their
 * own month and can never renumber/rekey subsequent documents. */
export function normalizeConversationSegments(
  channel: string,
  accountId: string,
  chatId: string,
  inputRows: WhatsAppMessageInput[],
  relationshipContext: ConversationRelationshipContext | null = null,
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedWhatsAppDocument[] {
  const byMonth = new Map<string, WhatsAppMessageInput[]>();
  for (const row of inputRows) {
    const month = whatsappCalendarMonth(row.occurredAt);
    const values = byMonth.get(month) ?? [];
    values.push(row);
    byMonth.set(month, values);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) =>
      normalizeConversation(channel, accountId, chatId, rows, relationshipContext, maxChars),
    );
}

export function normalizeWhatsAppConversationSegments(
  accountId: string,
  chatId: string,
  inputRows: WhatsAppMessageInput[],
  maxChars = DEFAULT_CHUNK_MAX_CHARS,
): NormalizedWhatsAppDocument[] {
  return normalizeConversationSegments('whatsapp', accountId, chatId, inputRows, null, maxChars);
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

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeConversationCursor(cursor?: string | null): ConversationCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof value.accountId !== 'string' || typeof value.chatId !== 'string') {
      return null;
    }
    // Cursors persisted before the all-channel migration contain only the
    // WhatsApp account/chat tuple. Preserve that progress across deploys.
    const channel = typeof value.channel === 'string' ? value.channel : 'whatsapp';
    return { channel, accountId: value.accountId, chatId: value.chatId };
  } catch {
    return null;
  }
}

export function assertConversationSourceCursor(
  cursor: ConversationCursor | null,
  channel: string,
  accountId: string,
): void {
  if (cursor && (cursor.channel !== channel || cursor.accountId !== accountId)) {
    throw new Error('conversation source backfill cursor does not belong to the requested source');
  }
}

/** One canonical eligibility predicate for discovery, reconciliation, reads,
 * and verified-empty source promotion. Keeping this shared prevents source
 * health from drifting away from the corpus population rules. */
export function eligibleConversationMessagePredicate(alias: string): SQL {
  const message = sql.identifier(alias);
  return sql`
    nullif(trim(${message}.chat_id), '') is not null
    and coalesce(${message}.is_group, false) = false
    and ${message}.is_bot is not true
    and nullif(trim(${message}.content), '') is not null
  `;
}

export const eligibleWhatsAppMessagePredicate = eligibleConversationMessagePredicate;

export async function ensureMasterBrain(
  ctx: CoreCtx,
  createdBy?: string | null,
  job?: CorpusJobScope,
): Promise<Brain> {
  return corpusScope(ctx, job, async (tx) => {
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

/** Discover one deterministic source for every content-bearing 1:1 chat
 * channel/account pair in the org-scoped ledger. */
export async function discoverConversationSources(
  ctx: CoreCtx,
  job?: CorpusJobScope,
): Promise<KnowledgeSource[]> {
  return corpusScope(ctx, job, async (tx) => {
    // The composite count(distinct (chat_id, month)) below sorts the org's
    // whole eligible ledger; at the server default work_mem (2MB) that sort
    // spilled ~88GB of temp file I/O per reconcile tick (2026-07 IO alert).
    // SET LOCAL keeps the bump scoped to this txn.
    await tx.execute(sql`select set_config('work_mem', '128MB', true)`);
    const accounts = (await tx.execute(sql`
      select lower(trim(message.channel)) as channel,
        coalesce(nullif(trim(message.account_id), ''), 'default') as account_id,
        count(distinct (
          message.chat_id,
          to_char(coalesce(message.occurred_at, message.created_at) at time zone 'UTC', 'YYYY-MM')
        )) filter (
          where ${eligibleConversationMessagePredicate('message')}
        )::int as conversation_count
      from messages message
      where message.org_id = current_setting('app.current_org_id', true)
        and nullif(trim(message.channel), '') is not null
      group by lower(trim(message.channel)),
        coalesce(nullif(trim(message.account_id), ''), 'default')
      having count(*) filter (
        where ${eligibleConversationMessagePredicate('message')}
      ) > 0
      order by lower(trim(message.channel)),
        coalesce(nullif(trim(message.account_id), ''), 'default')
    `)) as unknown as Array<{
      channel: string;
      account_id: string;
      conversation_count: number;
    }>;
    if (accounts.length === 0) return [];

    const values = sql.join(
      accounts.map(
        ({ channel, account_id, conversation_count }) => sql`(
        current_setting('app.current_org_id', true), ${channel}, ${account_id},
        ${`${channelLabel(channel)} ${account_id}`},
        ${JSON.stringify({ channel, accountId: account_id, domain: 'conversations', requiredModule: 'crm', requiredFieldLevel: 1 })}::jsonb,
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
        config = knowledge_sources.config || excluded.config,
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
          or(
            sql`${knowledgeSources.config}->>'domain' = 'conversations'`,
            eq(knowledgeSources.connector, WHATSAPP_CONNECTOR),
          ),
        ),
      )
      .orderBy(asc(knowledgeSources.connector), asc(knowledgeSources.externalKey));
  });
}

export async function discoverWhatsAppSources(ctx: CoreCtx): Promise<KnowledgeSource[]> {
  return (await discoverConversationSources(ctx)).filter(
    (source) => source.connector === WHATSAPP_CONNECTOR,
  );
}

/** Lightweight event-path ensure: no corpus-wide ledger aggregate. */
export async function ensureConversationSource(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
  job?: CorpusJobScope,
): Promise<KnowledgeSource> {
  const normalizedChannel = channel.trim().toLowerCase();
  const normalizedAccountId = accountId.trim();
  if (!normalizedChannel) throw new Error('conversation source requires a non-empty channel');
  if (!normalizedAccountId) throw new Error('conversation source requires a non-empty accountId');
  const source = await corpusScope(ctx, job, async (tx) => {
    await tx
      .insert(knowledgeSources)
      .values({
        orgId: ctx.tenantId,
        connector: normalizedChannel,
        externalKey: normalizedAccountId,
        name: `${channelLabel(normalizedChannel)} ${normalizedAccountId}`,
        config: {
          channel: normalizedChannel,
          accountId: normalizedAccountId,
          domain: 'conversations',
          requiredModule: 'crm',
          requiredFieldLevel: 1,
        },
        status: 'processing',
        syncMode: 'incremental',
        cadence: 'event+reconcile',
      })
      .onConflictDoUpdate({
        target: [knowledgeSources.orgId, knowledgeSources.connector, knowledgeSources.externalKey],
        set: {
          config: sql`${knowledgeSources.config} || excluded.config`,
          status: 'processing',
          lastError: null,
          updatedAt: new Date(),
        },
      });
    const [source] = await tx
      .select()
      .from(knowledgeSources)
      .where(
        and(
          eq(knowledgeSources.orgId, ctx.tenantId),
          eq(knowledgeSources.connector, normalizedChannel),
          eq(knowledgeSources.externalKey, normalizedAccountId),
        ),
      )
      .limit(1);
    if (!source) {
      throw new Error(`failed to ensure ${normalizedChannel} source ${normalizedAccountId}`);
    }
    return source;
  });
  // Master membership is implicit; the standard conversations focused scope needs
  // an explicit reference when an account first appears after bootstrap.
  await ensureMasterBrain(ctx, undefined, job);
  await ensureConversationsFocusedBrain(ctx, [source.id], undefined, job);
  return source;
}

export function ensureWhatsAppSource(ctx: CoreCtx, accountId: string): Promise<KnowledgeSource> {
  return ensureConversationSource(ctx, WHATSAPP_CONNECTOR, accountId);
}

export async function markConversationSourceFailure(
  ctx: CoreCtx,
  channel: string | null,
  accountId: string | null,
  cause: unknown,
  job?: CorpusJobScope & { nextProgress?: CorpusProgress },
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  await corpusScope(
    ctx,
    job,
    (tx) => {
      const channelFilter = channel ? sql`and connector = ${channel}` : sql``;
      const accountFilter = accountId ? sql`and external_key = ${accountId}` : sql``;
      return tx.execute(sql`
      update knowledge_sources
      set status = 'failed', last_error = ${message.slice(0, 1000)}, updated_at = now()
      where org_id = current_setting('app.current_org_id', true)
        and (
          config->>'domain' = 'conversations'
          or connector = ${WHATSAPP_CONNECTOR}
        )
        ${channelFilter}
        ${accountFilter}
    `);
    },
    job?.nextProgress,
  );
}

export function markWhatsAppSourceFailure(
  ctx: CoreCtx,
  accountId: string | null,
  cause: unknown,
): Promise<void> {
  return markConversationSourceFailure(ctx, WHATSAPP_CONNECTOR, accountId, cause);
}

const VERIFIED_EMPTY_WHATSAPP_SOURCE_STATUSES = ['discovered', 'queued'] as const;

/**
 * A source with no eligible 1:1 messages is still a successfully reconciled
 * source. Promote only idle discovery states after the full ledger scan has
 * completed; never erase a real processing/degraded/failed state here.
 */
export function canPromoteVerifiedEmptyWhatsAppSource(status: string): boolean {
  return (VERIFIED_EMPTY_WHATSAPP_SOURCE_STATUSES as readonly string[]).includes(status);
}

export async function markVerifiedEmptyConversationSourcesReady(ctx: CoreCtx): Promise<number> {
  return withOrgCore(ctx, (tx) => markVerifiedEmptyConversationSourcesReadyTx(tx));
}

async function markVerifiedEmptyConversationSourcesReadyTx(tx: CoreTx): Promise<number> {
  {
    const promoted = (await tx.execute(sql`
      update knowledge_sources source
      set status = 'ready', last_synced_at = now(), last_error = null, updated_at = now()
      where source.org_id = current_setting('app.current_org_id', true)
        and (
          source.config->>'domain' = 'conversations'
          or source.connector = ${WHATSAPP_CONNECTOR}
        )
        and source.status = any(${textArray([...VERIFIED_EMPTY_WHATSAPP_SOURCE_STATUSES])})
        and coalesce((source.watermark->>'expectedDocuments')::int, 0) = 0
        and not exists (
          select 1 from knowledge_documents document
          where document.org_id = source.org_id
            and document.source_id = source.id
            and document.status <> 'deleted'
        )
        and not exists (
          select 1 from messages message
          where message.org_id = source.org_id
            and lower(trim(message.channel)) = source.connector
            and coalesce(nullif(trim(message.account_id), ''), 'default') = source.external_key
            and ${eligibleConversationMessagePredicate('message')}
        )
      returning source.id
    `)) as unknown as Array<{ id: string }>;
    return promoted.length;
  }
}

export function markVerifiedEmptyWhatsAppSourcesReady(ctx: CoreCtx): Promise<number> {
  return markVerifiedEmptyConversationSourcesReady(ctx);
}

export async function ensureConversationsFocusedBrain(
  ctx: CoreCtx,
  sourceIds: string[],
  createdBy?: string | null,
  job?: CorpusJobScope,
): Promise<Brain | null> {
  if (sourceIds.length === 0) return null;
  return corpusScope(ctx, job, async (tx) => {
    let [brain] = await tx
      .select()
      .from(brains)
      .where(
        and(
          eq(brains.orgId, ctx.tenantId),
          eq(brains.kind, 'focused'),
          sql`${brains.name} in (${CONVERSATIONS_FOCUSED_BRAIN_NAME}, ${LEGACY_WHATSAPP_FOCUSED_BRAIN_NAME})`,
        ),
      )
      .orderBy(
        sql`case when ${brains.name} = ${CONVERSATIONS_FOCUSED_BRAIN_NAME} then 0 else 1 end`,
        asc(brains.createdAt),
      )
      .limit(1);
    if (!brain) {
      [brain] = await tx
        .insert(brains)
        .values({
          orgId: ctx.tenantId,
          name: CONVERSATIONS_FOCUSED_BRAIN_NAME,
          description:
            'Org-scoped customer conversations from every connected chat channel, enriched with joined CRM and related business context.',
          icon: 'message-circle',
          visibility: 'org',
          kind: 'focused',
          includeAllSources: false,
          createdBy: createdBy ?? null,
        })
        .returning();
    } else if (brain.name === LEGACY_WHATSAPP_FOCUSED_BRAIN_NAME) {
      const [renamed] = await tx
        .update(brains)
        .set({
          name: CONVERSATIONS_FOCUSED_BRAIN_NAME,
          description:
            'Org-scoped customer conversations from every connected chat channel, enriched with joined CRM and related business context.',
          updatedAt: new Date(),
        })
        .where(and(eq(brains.id, brain.id), eq(brains.orgId, ctx.tenantId)))
        .returning();
      if (renamed) brain = renamed;
    }
    await tx
      .insert(brainSources)
      .values(sourceIds.map((sourceId) => ({ brainId: brain.id, orgId: ctx.tenantId, sourceId })))
      .onConflictDoNothing();
    return brain;
  });
}

export function ensureWhatsAppFocusedBrain(
  ctx: CoreCtx,
  sourceIds: string[],
  createdBy?: string | null,
): Promise<Brain | null> {
  return ensureConversationsFocusedBrain(ctx, sourceIds, createdBy);
}

async function scanConversationKeys(
  tx: CoreTx,
  sourceByChannelAccount: Map<string, string>,
  cursor: ConversationCursor | null,
  limit: number,
): Promise<{ keys: WhatsAppConversationKey[]; hasMore: boolean }> {
  if (sourceByChannelAccount.size === 0) return { keys: [], hasMore: false };
  const sources = [...sourceByChannelAccount.keys()].map((key) => {
    const [channel, accountId] = key.split('\u0000');
    return { channel, accountId };
  });
  const sourceValues = sql.join(
    sources.map(({ channel, accountId }) => sql`(${channel}::text, ${accountId}::text)`),
    sql`, `,
  );
  const cursorFilter = cursor
    ? sql`and (
        lower(trim(m.channel)),
        coalesce(nullif(trim(m.account_id), ''), 'default'),
        m.chat_id
      ) > (${cursor.channel}, ${cursor.accountId}, ${cursor.chatId})`
    : sql``;
  const rows = (await tx.execute(sql`
    select lower(trim(m.channel)) as channel,
      coalesce(nullif(trim(m.account_id), ''), 'default') as account_id,
      m.chat_id
    from messages m
    where m.org_id = current_setting('app.current_org_id', true)
      and (
        lower(trim(m.channel)),
        coalesce(nullif(trim(m.account_id), ''), 'default')
      ) in (${sourceValues})
      and ${eligibleConversationMessagePredicate('m')}
      ${cursorFilter}
    group by lower(trim(m.channel)),
      coalesce(nullif(trim(m.account_id), ''), 'default'),
      m.chat_id
    order by lower(trim(m.channel)),
      coalesce(nullif(trim(m.account_id), ''), 'default'),
      m.chat_id
    limit ${limit + 1}
  `)) as unknown as Array<{ channel: string; account_id: string; chat_id: string }>;
  const hasMore = rows.length > limit;
  return {
    keys: rows.slice(0, limit).map((row) => ({
      channel: row.channel,
      accountId: row.account_id,
      chatId: row.chat_id,
      sourceId: sourceByChannelAccount.get(`${row.channel}\u0000${row.account_id}`)!,
    })),
    hasMore,
  };
}

async function scanConversationSourceKeys(
  tx: CoreTx,
  sourceId: string,
  channel: string,
  accountId: string,
  cursor: ConversationCursor | null,
  limit: number,
): Promise<{ keys: WhatsAppConversationKey[]; hasMore: boolean }> {
  const accountFilter =
    accountId === 'default'
      ? sql`coalesce(nullif(trim(m.account_id), ''), 'default') = 'default'`
      : sql`m.account_id = ${accountId}`;
  const cursorFilter = cursor ? sql`and m.chat_id > ${cursor.chatId}` : sql``;
  const rows = (await tx.execute(sql`
    select m.chat_id
    from messages m
    where m.org_id = current_setting('app.current_org_id', true)
      and m.channel = ${channel}
      and ${accountFilter}
      and ${eligibleConversationMessagePredicate('m')}
      ${cursorFilter}
    group by m.chat_id
    order by m.chat_id
    limit ${limit + 1}
  `)) as unknown as Array<{ chat_id: string }>;
  const hasMore = rows.length > limit;
  return {
    keys: rows.slice(0, limit).map((row) => ({
      channel,
      accountId,
      chatId: row.chat_id,
      sourceId,
    })),
    hasMore,
  };
}

function keyValues(keys: WhatsAppConversationKey[]) {
  return sql.join(
    keys.map((key) => sql`(${key.channel}::text, ${key.accountId}::text, ${key.chatId}::text)`),
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

async function loadConversationRows(
  tx: CoreTx,
  keys: WhatsAppConversationKey[],
  onlyMonths?: string[],
  exactSource = false,
): Promise<Map<string, WhatsAppMessageInput[]>> {
  const out = new Map<string, WhatsAppMessageInput[]>();
  if (keys.length === 0) return out;
  const monthFilter = onlyMonths?.length
    ? sql`where to_char(coalesce(occurred_at, created_at) at time zone 'UTC', 'YYYY-MM') = any(${textArray(onlyMonths)})`
    : sql``;
  const sourceFilter = exactSource
    ? sql`(
          m.channel,
          coalesce(nullif(m.account_id, ''), 'default'),
          m.chat_id
        ) in (${keyValues(keys)})`
    : sql`(
          lower(trim(m.channel)),
          coalesce(nullif(trim(m.account_id), ''), 'default'),
          m.chat_id
        ) in (${keyValues(keys)})`;
  const rows = (await tx.execute(sql`
    select normalized_channel as channel, normalized_account_id as account_id,
      chat_id, id::text as id, message_id, direction, content,
      sender_id, sender_name, occurred_at, created_at
    from (
      select distinct on (
        lower(trim(m.channel)),
        coalesce(nullif(trim(m.account_id), ''), 'default'),
        m.chat_id,
        coalesce(nullif(m.message_id, ''), 'row:' || m.id::text)
      ) m.*,
        lower(trim(m.channel)) as normalized_channel,
        coalesce(nullif(trim(m.account_id), ''), 'default') as normalized_account_id
      from messages m
      where m.org_id = current_setting('app.current_org_id', true)
        and ${eligibleConversationMessagePredicate('m')}
        and ${sourceFilter}
      order by lower(trim(m.channel)),
        coalesce(nullif(trim(m.account_id), ''), 'default'),
        m.chat_id,
        coalesce(nullif(m.message_id, ''), 'row:' || m.id::text),
        coalesce(m.occurred_at, m.created_at), m.id
    ) deduped
    ${monthFilter}
    order by normalized_channel, normalized_account_id, chat_id,
      coalesce(occurred_at, created_at), id
  `)) as unknown as Array<{
    channel: string;
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
    const key = `${row.channel}\u0000${row.account_id}\u0000${row.chat_id}`;
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

async function loadConversationRelationshipContexts(
  tx: CoreTx,
  keys: WhatsAppConversationKey[],
): Promise<Map<string, ConversationRelationshipContext | null>> {
  const out = new Map<string, ConversationRelationshipContext | null>();
  if (keys.length === 0) return out;
  const requested = sql.join(
    [...new Map(keys.map((key) => [`${key.channel}\u0000${key.chatId}`, key])).values()].map(
      (key) => sql`(${key.channel}::text, ${key.chatId}::text)`,
    ),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    with requested(channel, chat_id) as (values ${requested})
    select requested.channel, requested.chat_id,
      case when contact.id is null then null else jsonb_build_object(
        'contact', jsonb_build_object(
          'id', contact.id::text,
          'humanId', contact.human_id,
          'displayName', contact.display_name,
          'lifecycleOverride', contact.lifecycle_override,
          'source', contact.source
        ),
        'party', case when party.id is null then null else jsonb_build_object(
          'id', party.id::text,
          'type', party.type,
          'name', party.name
        ) end,
        'identities', coalesce(identities.rows, '[]'::jsonb),
        'tags', coalesce(tags.rows, '[]'::jsonb),
        'activities', coalesce(activities.rows, '[]'::jsonb)
      ) end as relationship_context
    from requested
    left join crm_contact_identities identity
      on identity.org_id = current_setting('app.current_org_id', true)
      and identity.channel = requested.channel
      and identity.external_id = requested.chat_id
    left join crm_contacts contact
      on contact.org_id = current_setting('app.current_org_id', true)
      and contact.id = identity.contact_id
      and contact.deleted_at is null
    left join parties party
      on party.org_id = current_setting('app.current_org_id', true)
      and party.id = contact.party_id
    left join lateral (
      select jsonb_agg(jsonb_build_object('channel', ci.channel) order by ci.channel) as rows
      from crm_contact_identities ci
      where ci.org_id = current_setting('app.current_org_id', true)
        and ci.contact_id = contact.id
    ) identities on true
    left join lateral (
      select jsonb_agg(tag.name order by tag.position, tag.name) as rows
      from crm_contact_tags membership
      join crm_tags tag
        on tag.org_id = current_setting('app.current_org_id', true)
        and tag.id = membership.tag_id
      where membership.org_id = current_setting('app.current_org_id', true)
        and membership.contact_id = contact.id
    ) tags on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'kind', activity.kind,
        'occurredAt', activity.occurred_at
      ) order by activity.occurred_at desc) as rows
      from (
        select kind, occurred_at
        from crm_activities
        where org_id = current_setting('app.current_org_id', true)
          and contact_id = contact.id
        order by occurred_at desc
        limit 10
      ) activity
    ) activities on true
  `)) as unknown as Array<{
    channel: string;
    chat_id: string;
    relationship_context: ConversationRelationshipContext | null;
  }>;
  for (const row of rows) {
    out.set(`${row.channel}\u0000${row.chat_id}`, row.relationship_context);
  }
  return out;
}

async function prepareConversations(
  tx: CoreTx,
  keys: WhatsAppConversationKey[],
  onlyMonths?: string[],
  exactSource = false,
): Promise<PreparedConversation[]> {
  const [rowsByKey, contextByKey] = await Promise.all([
    loadConversationRows(tx, keys, onlyMonths, exactSource),
    loadConversationRelationshipContexts(tx, keys),
  ]);
  const normalized = keys
    .flatMap((key) => {
      const rows = rowsByKey.get(`${key.channel}\u0000${key.accountId}\u0000${key.chatId}`) ?? [];
      return rows.length > 0
        ? normalizeConversationSegments(
            key.channel,
            key.accountId,
            key.chatId,
            rows,
            contextByKey.get(`${key.channel}\u0000${key.chatId}`) ?? null,
          ).map((document) => ({ key, document }))
        : [];
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
            (!qdrantOwnsKnowledgeEmbeddings() &&
              (!old.has_embedding || old.embedding_model !== KNOWLEDGE_EMBEDDING_MODEL))
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
  if (changed.length === 0 || qdrantOwnsKnowledgeEmbeddings() || !embeddingsEnabled()) return out;
  const batches: Array<typeof changed> = [];
  for (let i = 0; i < changed.length; i += EMBEDDING_BATCH_SIZE) {
    batches.push(changed.slice(i, i + EMBEDDING_BATCH_SIZE));
  }
  for (let i = 0; i < batches.length; i += EMBEDDING_BATCH_CONCURRENCY) {
    const group = batches.slice(i, i + EMBEDDING_BATCH_CONCURRENCY);
    const results = await Promise.all(
      group.map((batch) => embedTexts(batch.map((item) => item.text))),
    );
    group.forEach((batch, groupIndex) => {
      batch.forEach((item, index) => out.set(item.key, results[groupIndex][index]));
    });
  }
  return out;
}

async function persistConversations(
  ctx: CoreCtx,
  prepared: PreparedConversation[],
  vectors: Map<string, number[]>,
): Promise<{ deletedChunks: number }> {
  if (prepared.length === 0) return { deletedChunks: 0 };
  const qdrantStorage = qdrantOwnsKnowledgeEmbeddings();
  return withOrgCore(ctx, (tx) => persistConversationsTx(tx, prepared, vectors, qdrantStorage));
}

/** One transaction per prepared page; the caller owns it (org-scoped or job-owned). */
async function persistConversationsTx(
  tx: CoreTx,
  prepared: PreparedConversation[],
  vectors: Map<string, number[]>,
  qdrantStorage: boolean,
): Promise<{ deletedChunks: number }> {
  {
    if (qdrantStorage) {
      const generations = (await tx.execute(sql`
        select public.brain_vector_app_generation_mode() as storage_mode
      `)) as unknown as Array<{ storage_mode: string | null }>;
      if (generations[0]?.storage_mode !== 'qdrant') {
        throw new Error(
          'BRAIN_VECTOR_STORAGE_MODE=qdrant requires one active Qdrant-owned vector generation',
        );
      }
    }
    let deletedChunks = 0;
    for (const conversation of prepared) {
      // A reconcile page can contain hundreds of documents whose hashes and
      // embeddings are already current. Do not turn an idempotency check into
      // per-document/chunk writes; source health/freshness is updated once
      // below for every source represented by the page.
      if (!preparedConversationNeedsWrite(conversation)) continue;
      const { document, documentId, key } = conversation;
      const allChangedEmbedded = [...conversation.changedChunkKeys].every((chunkKey) =>
        vectors.has(`${documentId}\u0000${chunkKey}`),
      );
      const documentStatus =
        !qdrantStorage && conversation.changedChunkKeys.size > 0 && !allChangedEmbedded
          ? 'pending'
          : 'ready';
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
    await refreshConversationSourceStateTx(tx, sourceIds, qdrantStorage);
    return { deletedChunks };
  }
}

async function refreshConversationSourceStateTx(
  tx: CoreTx,
  sourceIds: string[],
  qdrantStorage: boolean,
): Promise<void> {
  if (sourceIds.length === 0) return;
  await tx.execute(sql`
    update knowledge_sources
    set status = case
          when coalesce((watermark->>'expectedDocuments')::int, 0) > (
            select count(*)::int from knowledge_documents document
            where document.org_id = knowledge_sources.org_id
              and document.source_id = knowledge_sources.id and document.status <> 'deleted'
          ) then 'queued'
          when ${qdrantStorage}
            then public.brain_vector_app_source_state(knowledge_sources.id)
          when exists (
            select 1 from knowledge_chunks chunk
            where chunk.org_id = knowledge_sources.org_id
              and chunk.source_id = knowledge_sources.id
              and chunk.embedding is null
          ) then 'queued'
          else 'ready'
        end,
        last_synced_at = now(), last_error = null, updated_at = now()
    where org_id = current_setting('app.current_org_id', true)
      and id = any(${uuidArray(sourceIds)})
  `);
}

async function refreshConversationSourceState(ctx: CoreCtx, sourceId: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    refreshConversationSourceStateTx(tx, [sourceId], qdrantOwnsKnowledgeEmbeddings()),
  );
}

/** Progress input for a job-owned conversation page; deletions are not known
 * before the final commit and never change the cursor. */
export type ConversationPageProgress = Pick<
  WhatsAppBackfillResult,
  'processed' | 'changedChunks' | 'embeddedChunks' | 'nextCursor' | 'hasMore'
>;

function conversationPageSource(item: PreparedConversation): LoadedPageSource {
  return {
    family: CONVERSATION_CORPUS_FAMILY,
    entityId: `${item.key.sourceId}:${item.document.externalId}`,
    sourceHash: item.document.contentHash,
    chunks: item.document.chunks.map((chunk) => ({
      key: chunk.chunkKey,
      text: `${chunk.contextPrefix}\n\n${chunk.chunkText}`,
    })),
    requiredChunkKeys: [...item.changedChunkKeys],
  };
}

/** The observed source snapshot is the re-normalized ledger content: an older
 * prepared page cannot bind or publish once the conversation changed.
 * ponytail: re-normalizes the page's messages on every guard call; a cheaper
 * ledger fingerprint can replace it if guard cost shows in profiles. */
function conversationSnapshotGuard(
  keys: WhatsAppConversationKey[],
  onlyMonths: string[] | undefined,
  exactSource: boolean,
  prepared: PreparedConversation[],
): PageDomainGuard {
  const expected = new Map(
    prepared.map((item) => [
      `${item.key.sourceId}\u0000${item.document.externalId}`,
      item.document.contentHash,
    ]),
  );
  return async (tx) => {
    if (expected.size === 0) return;
    const [rowsByKey, contextByKey] = await Promise.all([
      loadConversationRows(tx, keys, onlyMonths, exactSource),
      loadConversationRelationshipContexts(tx, keys),
    ]);
    const current = new Map<string, string>();
    for (const key of keys) {
      const rows = rowsByKey.get(`${key.channel}\u0000${key.accountId}\u0000${key.chatId}`) ?? [];
      if (rows.length === 0) continue;
      for (const document of normalizeConversationSegments(
        key.channel,
        key.accountId,
        key.chatId,
        rows,
        contextByKey.get(`${key.channel}\u0000${key.chatId}`) ?? null,
      ))
        current.set(`${key.sourceId}\u0000${document.externalId}`, document.contentHash);
    }
    for (const [id, hash] of expected)
      if (current.get(id) !== hash)
        throw new JobEffectPageError('superseded', 'Conversation source changed after preparation');
  };
}

/** Job-owned replacement for runPreparedBatch: shared receipts, page-atomic
 * publication and exact progress. Failure state is written by the job wrapper. */
async function publishOwnedConversations(
  ctx: CoreCtx,
  job: CorpusJobContext<ConversationPageProgress>,
  prepared: PreparedConversation[],
  input: {
    pageKeyPrefix: string;
    guard: PageDomainGuard;
    finalize: (tx: CoreTx) => Promise<void>;
    page: Pick<ConversationPageProgress, 'nextCursor' | 'hasMore'>;
  },
): Promise<Omit<WhatsAppBackfillResult, 'nextCursor' | 'hasMore'>> {
  const qdrantStorage = qdrantOwnsKnowledgeEmbeddings();
  const policy = corpusEmbeddingPolicy(qdrantStorage);
  const changedChunks = prepared.reduce((sum, row) => sum + row.changedChunkKeys.size, 0);
  const expectedEmbedded = policy.mode === 'embedded' ? changedChunks : 0;
  const progress = job.progress({
    processed: prepared.length,
    changedChunks,
    embeddedChunks: expectedEmbedded,
    ...input.page,
  });
  let deletedChunks = 0;
  const published = await publishCorpusPages(ctx, job, {
    pageKeyPrefix: input.pageKeyPrefix,
    pipelineVersion: CONVERSATION_CORPUS_PIPELINE,
    policy,
    items: prepared
      .filter(preparedConversationNeedsWrite)
      .map((item) => ({ item, source: conversationPageSource(item) })),
    validateDomain: input.guard,
    publish: async (tx, items, vectors) => {
      deletedChunks += (await persistConversationsTx(tx, items, vectors, qdrantStorage))
        .deletedChunks;
    },
    finalize: input.finalize,
    nextProgress: progress,
  });
  return {
    processed: prepared.length,
    changedDocuments: prepared.filter((row) => row.changedDocument).length,
    changedChunks,
    embeddedChunks: published.embeddedChunks,
    unchangedChunks: prepared.reduce(
      (sum, row) => sum + row.document.chunks.length - row.changedChunkKeys.size,
      0,
    ),
    deletedChunks,
  };
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
export async function reconcileDeletedConversationDocuments(
  ctx: CoreCtx,
  only?: { channel: string; accountId: string; chatId?: string; months?: string[] },
): Promise<WhatsAppReconcileResult> {
  return withOrgCore(ctx, (tx) => reconcileDeletedConversationDocumentsTx(tx, only));
}

async function reconcileDeletedConversationDocumentsTx(
  tx: CoreTx,
  only?: { channel: string; accountId: string; chatId?: string; months?: string[] },
): Promise<WhatsAppReconcileResult> {
  {
    const monthScope = only?.months?.length
      ? sql`and (
          document.metadata->>'segmentMonth' is null
          or document.metadata->>'segmentMonth' = any(${textArray(only.months)})
        )`
      : sql``;
    const chatScope = only?.chatId ? sql`and document.metadata->>'chatId' = ${only.chatId}` : sql``;
    const specific = only
      ? sql`and source.connector = ${only.channel}
            and source.external_key = ${only.accountId}
            ${chatScope}
            ${monthScope}`
      : sql``;
    const tombstones = (await tx.execute(sql`
      update knowledge_documents document
      set status = 'deleted', ingested_at = now(), updated_at = now()
      from knowledge_sources source
      where document.org_id = current_setting('app.current_org_id', true)
        and source.org_id = document.org_id and source.id = document.source_id
        and (
          source.config->>'domain' = 'conversations'
          or source.connector = ${WHATSAPP_CONNECTOR}
        )
        and document.status <> 'deleted'
        ${specific}
        and (
          document.metadata->>'segmentMonth' is null
          or not exists (
          select 1 from messages message
          where message.org_id = document.org_id
            and lower(trim(message.channel)) = source.connector
            and coalesce(nullif(trim(message.account_id), ''), 'default') = source.external_key
            and message.chat_id = document.metadata->>'chatId'
            and to_char(
              coalesce(message.occurred_at, message.created_at) at time zone 'UTC',
              'YYYY-MM'
            ) = document.metadata->>'segmentMonth'
            and ${eligibleConversationMessagePredicate('message')}
          )
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
  }
}

export function reconcileDeletedWhatsAppDocuments(
  ctx: CoreCtx,
  only?: { accountId: string; chatId: string; months?: string[] },
): Promise<WhatsAppReconcileResult> {
  return reconcileDeletedConversationDocuments(
    ctx,
    only ? { channel: WHATSAPP_CONNECTOR, ...only } : undefined,
  );
}

/** Cursor-driven full/catch-up page. Re-running from the start is idempotent. */
export async function backfillConversations(
  ctx: CoreCtx,
  opts?: { cursor?: string | null; limit?: number },
  job?: CorpusJobContext<ConversationPageProgress>,
): Promise<WhatsAppBackfillResult> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? DEFAULT_CONVERSATION_BATCH)));
  await ensureMasterBrain(ctx, undefined, job);
  const sources = await discoverConversationSources(ctx, job);
  await ensureConversationsFocusedBrain(
    ctx,
    sources.map((source) => source.id),
    undefined,
    job,
  );
  const sourceByChannelAccount = new Map(
    sources.map((source) => [`${source.connector}\u0000${source.externalKey}`, source.id]),
  );
  const cursor = decodeConversationCursor(opts?.cursor);
  const preparedPage = await corpusScope(ctx, job, async (tx) => {
    const page = await scanConversationKeys(tx, sourceByChannelAccount, cursor, limit);
    return { ...page, prepared: await prepareConversations(tx, page.keys) };
  });
  const last = preparedPage.keys.at(-1) ?? null;
  const nextCursor =
    preparedPage.hasMore && last
      ? encodeConversationCursor({
          channel: last.channel,
          accountId: last.accountId,
          chatId: last.chatId,
        })
      : null;
  if (job) {
    const reconciled = { deletedDocuments: 0, deletedChunks: 0 };
    const counts = await publishOwnedConversations(ctx, job, preparedPage.prepared, {
      pageKeyPrefix: 'conv:reconcile',
      guard: conversationSnapshotGuard(preparedPage.keys, undefined, false, preparedPage.prepared),
      finalize: async (tx) => {
        if (preparedPage.hasMore) return;
        Object.assign(reconciled, await reconcileDeletedConversationDocumentsTx(tx));
        await markVerifiedEmptyConversationSourcesReadyTx(tx);
      },
      page: { nextCursor, hasMore: preparedPage.hasMore },
    });
    return {
      ...counts,
      deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
      nextCursor,
      hasMore: preparedPage.hasMore,
    };
  }
  const counts = await runPreparedBatch(ctx, preparedPage.prepared);
  let reconciled = { deletedDocuments: 0, deletedChunks: 0 };
  if (!preparedPage.hasMore) {
    reconciled = await reconcileDeletedConversationDocuments(ctx);
    await markVerifiedEmptyConversationSourcesReady(ctx);
  }
  return {
    ...counts,
    deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
    nextCursor,
    hasMore: preparedPage.hasMore,
  };
}

export function backfillWhatsAppConversations(
  ctx: CoreCtx,
  opts?: { cursor?: string | null; limit?: number },
): Promise<WhatsAppBackfillResult> {
  return backfillConversations(ctx, opts);
}

/**
 * Cursor-driven backfill for one already-known channel/account source.
 *
 * Unlike backfillConversations(), this path intentionally avoids the full
 * all-channel discovery aggregate on every page. It is the production-safe
 * repair path for large sources such as an Instagram account: resumable,
 * idempotent, and bounded by the same page limit.
 */
export async function backfillConversationSource(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
  opts?: { cursor?: string | null; limit?: number },
): Promise<WhatsAppBackfillResult> {
  const normalizedChannel = channel.trim().toLowerCase();
  const normalizedAccountId = accountId.trim();
  const limit = Math.max(1, Math.min(500, Math.floor(opts?.limit ?? DEFAULT_CONVERSATION_BATCH)));
  const source = await ensureConversationSource(ctx, normalizedChannel, normalizedAccountId);
  const cursor = decodeConversationCursor(opts?.cursor);
  assertConversationSourceCursor(cursor, normalizedChannel, normalizedAccountId);
  const preparedPage = await withOrgCore(ctx, async (tx) => {
    const page = await scanConversationSourceKeys(
      tx,
      source.id,
      normalizedChannel,
      normalizedAccountId,
      cursor,
      limit,
    );
    return { ...page, prepared: await prepareConversations(tx, page.keys, undefined, true) };
  });
  const counts = await runPreparedBatch(ctx, preparedPage.prepared);
  const last = preparedPage.keys.at(-1) ?? null;
  let reconciled = { deletedDocuments: 0, deletedChunks: 0 };
  if (!preparedPage.hasMore) {
    reconciled = await reconcileDeletedConversationDocuments(ctx, {
      channel: normalizedChannel,
      accountId: normalizedAccountId,
    });
    // An empty terminal page bypasses persistConversations(), so explicitly
    // clear the processing state established by ensureConversationSource().
    await refreshConversationSourceState(ctx, source.id);
  }
  return {
    ...counts,
    deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
    nextCursor:
      preparedPage.hasMore && last
        ? encodeConversationCursor({
            channel: last.channel,
            accountId: last.accountId,
            chatId: last.chatId,
          })
        : null,
    hasMore: preparedPage.hasMore,
  };
}

/** Event-hook target: rebuild exactly one channel/account-scoped conversation. */
export async function syncConversation(
  ctx: CoreCtx,
  channel: string,
  accountId: string,
  chatId: string,
  opts?: { months?: string[] },
  job?: CorpusJobContext<ConversationPageProgress>,
): Promise<WhatsAppBackfillResult> {
  const source = await ensureConversationSource(ctx, channel, accountId, job);
  const key = { channel, accountId, chatId, sourceId: source.id };
  const months = opts?.months?.filter((month) => /^\d{4}-\d{2}$/.test(month));
  const prepared = await corpusScope(ctx, job, (tx) =>
    prepareConversations(tx, [key], months, true),
  );
  if (job) {
    const reconciled = { deletedDocuments: 0, deletedChunks: 0 };
    const counts = await publishOwnedConversations(ctx, job, prepared, {
      pageKeyPrefix: 'conv:dirty',
      guard: conversationSnapshotGuard([key], months, true, prepared),
      finalize: async (tx) => {
        Object.assign(
          reconciled,
          await reconcileDeletedConversationDocumentsTx(tx, { channel, accountId, chatId, months }),
        );
      },
      page: { nextCursor: null, hasMore: false },
    });
    return {
      ...counts,
      deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
      nextCursor: null,
      hasMore: false,
    };
  }
  if (prepared.length === 0) {
    const reconciled = await reconcileDeletedConversationDocuments(ctx, {
      channel,
      accountId,
      chatId,
      months,
    });
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
  const counts = await runPreparedBatch(ctx, prepared);
  const reconciled = await reconcileDeletedConversationDocuments(ctx, {
    channel,
    accountId,
    chatId,
    months,
  });
  return {
    ...counts,
    deletedChunks: counts.deletedChunks + reconciled.deletedChunks,
    nextCursor: null,
    hasMore: false,
  };
}

export function syncWhatsAppConversation(
  ctx: CoreCtx,
  accountId: string,
  chatId: string,
  opts?: { months?: string[] },
): Promise<WhatsAppBackfillResult> {
  return syncConversation(ctx, WHATSAPP_CONNECTOR, accountId, chatId, opts);
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
  const sources = await discoverConversationSources(ctx);
  const focusedBrain = await ensureConversationsFocusedBrain(
    ctx,
    sources.map((source) => source.id),
    opts?.createdBy,
  );
  const backfill = await backfillConversations(ctx, {
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
  // Display stats over ~130k documents + ~130k chunks (1 GB with the vector
  // column) on an IO-bound shared instance. The numbers only move on ingest,
  // so serve cached/stale instantly and refresh in the background instead of
  // blocking every /brains navigation (2026-09-08: the load hung >2 min and
  // the client surfaced it as a NetworkError). Membership is part of the key.
  const requestedKey = requested
    .map((brain) => `${brain.id}:${brain.includeAllSources ? 1 : 0}`)
    .sort()
    .join(',');
  return cached(
    keys.hub('brain-source-aggregates', {
      t: ctx.tenantId,
      d: { r: createHash('sha256').update(requestedKey).digest('hex').slice(0, 16) },
    }),
    { ttl: '2m', swr: '1h', tags: [...tags.tenantDomain(ctx.tenantId, 'brains')] },
    () => computeSourceAggregates(ctx, requested),
  );
}

async function computeSourceAggregates(
  ctx: CoreCtx,
  requested: Brain[],
): Promise<SourceAggregateRow[]> {
  const values = sql.join(
    requested.map((brain) => sql`(${brain.id}::uuid, ${brain.includeAllSources}::boolean)`),
    sql`, `,
  );
  return withOrgCore(
    ctx,
    async (tx) =>
      (await tx.execute(sql`
    with requested(brain_id, include_all_sources) as (values ${values}),
    -- Counts depend ONLY on the source. The old shape computed them in a
    -- lateral under a cross join with requested (N brains x M sources full
    -- document+chunk joins). Now: one index-only pass over documents, one over
    -- chunks (chunks carry source_id), and the unembedded count off the partial
    -- index — no document<->chunk join at all. The only correlated probe is the
    -- "pending document without chunks" check, which runs for the handful of
    -- non-ready documents only.
    doc_counts as (
      select document.source_id, count(*)::int as document_count
      from knowledge_documents document
      where document.org_id = current_setting('app.current_org_id', true)
        and document.status <> 'deleted'
      group by document.source_id
    ),
    -- Kept apart from doc_counts on purpose: the not-exists probe needs
    -- document.id, which would turn the whole documents pass into a heap scan.
    -- Restricted to the non-ready statuses it stays a tiny index range.
    pending_docs as (
      select document.source_id, count(*)::int as pending_document_count
      from knowledge_documents document
      where document.org_id = current_setting('app.current_org_id', true)
        and document.status in ('pending', 'processing', 'failed')
        and not exists (
          select 1 from knowledge_chunks chunk
          where chunk.org_id = document.org_id and chunk.document_id = document.id
        )
      group by document.source_id
    ),
    chunk_counts as (
      select chunk.source_id, count(*)::int as chunk_count
      from knowledge_chunks chunk
      where chunk.org_id = current_setting('app.current_org_id', true)
      group by chunk.source_id
    ),
    unembedded_counts as (
      select chunk.source_id, count(*)::int as unembedded_chunk_count
      from knowledge_chunks chunk
      where chunk.org_id = current_setting('app.current_org_id', true)
        and chunk.embedding is null
      group by chunk.source_id
    ),
    source_stats as (
      select source.id as source_id,
        coalesce(dc.document_count, 0) as document_count,
        coalesce(cc.chunk_count, 0) as chunk_count,
        (
          ${
            qdrantOwnsKnowledgeEmbeddings()
              ? sql`case
                  when source.config->>'domain' = 'conversations'
                    then public.brain_vector_app_source_pending_count(source.id)
                  else coalesce(uc.unembedded_chunk_count, 0)
                end`
              : sql`coalesce(uc.unembedded_chunk_count, 0)`
          }
          + coalesce(pd.pending_document_count, 0)
          + greatest(
              coalesce((source.watermark->>'expectedDocuments')::int, 0)
                - coalesce(dc.document_count, 0),
              0
            )
        )::int as pending_count
      from knowledge_sources source
      left join doc_counts dc on dc.source_id = source.id
      left join pending_docs pd on pd.source_id = source.id
      left join chunk_counts cc on cc.source_id = source.id
      left join unembedded_counts uc on uc.source_id = source.id
      where source.org_id = current_setting('app.current_org_id', true)
    )
    select requested.brain_id::text,
      source.id::text as source_id, source.name, source.connector,
      source.external_key, source.config as source_config,
      source.status, source.sync_mode, source.cadence,
      source.last_synced_at, source.last_error, membership.weight,
      (requested.include_all_sources or membership.source_id is not null) as member,
      stats.document_count, stats.chunk_count, stats.pending_count
    from requested
    cross join knowledge_sources source
    left join brain_sources membership
      on membership.org_id = current_setting('app.current_org_id', true)
      and membership.brain_id = requested.brain_id and membership.source_id = source.id
    join source_stats stats on stats.source_id = source.id
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
  const sourceRows = (await loadSourceAggregates(ctx, rows)).filter((row) =>
    canPrincipalSearchKnowledgeSource(row.source_config, principal),
  );
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
  const rows = (await loadSourceAggregates(ctx, [rawBrain])).filter((row) =>
    canPrincipalSearchKnowledgeSource(row.source_config, principal),
  );
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

/**
 * Attach or detach one shared corpus source from a Focused Brain. Master Brain
 * membership is implicit and therefore never mutable through this path.
 *
 * Both records are loaded inside the caller's forced-RLS org transaction. A
 * guessed source id from another organization is indistinguishable from a
 * missing source, and changing membership never mutates or re-embeds corpus
 * documents/chunks.
 */
export async function setFocusedBrainSourceMembership(
  ctx: CoreCtx,
  brainId: string,
  sourceId: string,
  member: boolean,
  principal: AccessPrincipal,
  actor: { id: string | null; name: string | null },
): Promise<BrainSourceMembershipResult> {
  const { canAccessBrain } = await import('./brains.service');
  if (!(await canAccessBrain(ctx, brainId, 'write', principal))) {
    throw error(404, 'Brain or source not found');
  }

  const result = await withOrgCore(ctx, async (tx) => {
    const [brain] = await tx
      .select({ id: brains.id, kind: brains.kind })
      .from(brains)
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .limit(1);
    if (!brain) throw error(404, 'Brain or source not found');
    if (brain.kind === 'master') {
      throw error(409, 'Master Brain sources are managed organization-wide');
    }

    const [source] = await tx
      .select({ id: knowledgeSources.id, config: knowledgeSources.config })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.orgId, ctx.tenantId)))
      .limit(1);
    if (!source) throw error(404, 'Brain or source not found');
    if (!canPrincipalSearchKnowledgeSource(source.config, principal)) {
      throw error(404, 'Brain or source not found');
    }

    if (member) {
      const inserted = await tx
        .insert(brainSources)
        .values({ brainId, orgId: ctx.tenantId, sourceId, weight: 1, config: {} })
        .onConflictDoNothing()
        .returning({ sourceId: brainSources.sourceId });
      return { sourceId, member: true, changed: inserted.length > 0 };
    }

    const removed = await tx
      .delete(brainSources)
      .where(
        and(
          eq(brainSources.brainId, brainId),
          eq(brainSources.sourceId, sourceId),
          eq(brainSources.orgId, ctx.tenantId),
        ),
      )
      .returning({ sourceId: brainSources.sourceId });
    return { sourceId, member: false, changed: removed.length > 0 };
  });

  if (result.changed) {
    const { recordAudit } = await import('./activity.service');
    await recordAudit(ctx, {
      refType: 'brain',
      refId: brainId,
      op: 'update',
      changes: [
        {
          field: 'source_membership',
          label: 'Knowledge source',
          old: member ? null : sourceId,
          new: member ? sourceId : null,
        },
      ],
      actor,
    });
  }

  return result;
}
