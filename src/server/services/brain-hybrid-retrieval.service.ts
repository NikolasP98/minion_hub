import { error } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  brains,
  brainSources,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeSources,
} from '$server/db/pg-schema/brains';
import { withOrgCore } from '$server/db/with-org-core';
import { canAccessBrain, searchBrain, type AccessPrincipal } from './brains.service';
import { embeddingsEnabled, embedTexts, toVectorLiteral } from './embeddings';

/** Cerebras-style deterministic fusion. Ranks are one-based. */
export const HYBRID_RRF_K = 60;

const VECTOR_WEIGHT = 1;
const LEXICAL_WEIGHT = 0.85;
const RECENCY_WEIGHT = 0.15;
const DEFAULT_RECENCY_HALF_LIFE_DAYS = 180;
const CHAT_RECENCY_HALF_LIFE_DAYS = 90;
const MAX_CANDIDATES = 200;
const MAX_LIMIT = 50;

type JsonRecord = Record<string, unknown>;

export interface BrainHybridSearchOptions {
  limit?: number;
  sourceIds?: string[];
  connectors?: string[];
  kinds?: string[];
  metadata?: Record<string, string | number | boolean>;
  neighborRadius?: number;
  /** Test/diagnostic override. Ranking is deterministic for a fixed clock. */
  now?: Date;
}

export interface BrainEvidenceNeighbor {
  chunkId: string;
  chunkKey: string;
  kind: string;
  seq: number;
  chunkText: string;
  contextPrefix: string | null;
}

export interface BrainHybridSearchHit {
  // Legacy-compatible fields used by the existing Hub and Gateway callers.
  chunkId: string;
  documentId: string;
  documentTitle: string;
  seq: number;
  chunkText: string;
  score: number;

  sourceId: string | null;
  sourceName: string | null;
  connector: string | null;
  sourceExternalKey: string | null;
  documentExternalId: string | null;
  chunkKey: string | null;
  kind: string | null;
  contextPrefix: string | null;
  occurredAt: string | null;
  metadata: JsonRecord;
  citation: {
    sourceId: string | null;
    sourceName: string | null;
    connector: string | null;
    sourceExternalKey: string | null;
    documentId: string;
    documentExternalId: string | null;
    documentTitle: string;
    occurredAt: string | null;
    metadata: JsonRecord;
  };
  scores: {
    vector: number | null;
    lexical: number | null;
    recency: number;
    rrf: { vector: number; lexical: number; recency: number };
    fused: number;
    normalized: number;
    sourceWeight: number;
  };
  neighbors: BrainEvidenceNeighbor[];
  expandedText: string;
}

export interface BrainHybridSearchResult {
  mode: 'hybrid' | 'legacy';
  hits: BrainHybridSearchHit[];
  diagnostics: {
    vectorCandidates: number;
    lexicalCandidates: number;
    fusedCandidates: number;
    warnings: string[];
  };
}

interface CanonicalCandidateRow {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  connector: string;
  sourceExternalKey: string;
  sourceConfig: unknown;
  documentId: string;
  documentExternalId: string;
  documentTitle: string;
  chunkKey: string;
  kind: string;
  seq: number;
  chunkText: string;
  contextPrefix: string | null;
  contentHash: string;
  occurredAt: Date | string | null;
  metadata: unknown;
  includeAllSources: boolean;
  membershipWeight: number | null;
  membershipConfig: unknown;
  retrievalScore: number;
}

export interface HybridCandidate {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  connector: string;
  sourceExternalKey: string;
  documentId: string;
  documentExternalId: string;
  documentTitle: string;
  chunkKey: string;
  kind: string;
  seq: number;
  chunkText: string;
  contextPrefix: string | null;
  contentHash: string;
  occurredAt: string | null;
  metadata: JsonRecord;
  sourceWeight: number;
  recencyHalfLifeDays: number;
  vectorScore: number | null;
  lexicalScore: number | null;
}

interface RankedCandidate extends HybridCandidate {
  recencyScore: number;
  vectorRank: number | null;
  lexicalRank: number | null;
  recencyRank: number | null;
  rrfVector: number;
  rrfLexical: number;
  rrfRecency: number;
  fusedScore: number;
  normalizedScore: number;
}

interface NeighborRow {
  chunkId: string;
  documentId: string;
  chunkKey: string;
  kind: string;
  seq: number;
  chunkText: string;
  contextPrefix: string | null;
}

function asJsonRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function finitePositive(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function configuredHalfLife(row: CanonicalCandidateRow): number {
  const membership = row.includeAllSources ? {} : asJsonRecord(row.membershipConfig);
  const source = asJsonRecord(row.sourceConfig);
  const configured =
    finitePositive(membership.recencyHalfLifeDays) ??
    finitePositive(membership.recency_half_life_days) ??
    finitePositive(source.recencyHalfLifeDays) ??
    finitePositive(source.recency_half_life_days);
  if (configured !== null) return configured;
  return ['whatsapp', 'instagram', 'telegram', 'slack'].includes(row.connector)
    ? CHAT_RECENCY_HALF_LIFE_DAYS
    : DEFAULT_RECENCY_HALF_LIFE_DAYS;
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toCandidate(row: CanonicalCandidateRow, retriever: 'vector' | 'lexical'): HybridCandidate {
  const sourceWeight = row.includeAllSources ? 1 : (finitePositive(row.membershipWeight) ?? 1);
  return {
    chunkId: row.chunkId,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    connector: row.connector,
    sourceExternalKey: row.sourceExternalKey,
    documentId: row.documentId,
    documentExternalId: row.documentExternalId,
    documentTitle: row.documentTitle,
    chunkKey: row.chunkKey,
    kind: row.kind,
    seq: row.seq,
    chunkText: row.chunkText,
    contextPrefix: row.contextPrefix,
    contentHash: row.contentHash,
    occurredAt: isoDate(row.occurredAt),
    metadata: asJsonRecord(row.metadata),
    sourceWeight,
    recencyHalfLifeDays: configuredHalfLife(row),
    vectorScore: retriever === 'vector' ? Number(row.retrievalScore) : null,
    lexicalScore: retriever === 'lexical' ? Number(row.retrievalScore) : null,
  };
}

/** Exponential half-life decay. Future timestamps are treated as current. */
export function computeRecencyScore(
  occurredAt: string | null,
  halfLifeDays: number,
  now: Date,
): number {
  if (!occurredAt) return 0;
  const occurredMs = new Date(occurredAt).getTime();
  if (!Number.isFinite(occurredMs)) return 0;
  const ageDays = Math.max(0, now.getTime() - occurredMs) / 86_400_000;
  return 2 ** (-ageDays / Math.max(halfLifeDays, 1));
}

function stableMessageKey(candidate: HybridCandidate): string | null {
  for (const key of ['messageId', 'message_id', 'channelMessageId', 'channel_message_id']) {
    const value = candidate.metadata[key];
    if (typeof value === 'string' && value) return `${candidate.connector}:${value}`;
  }
  for (const key of ['messageIds', 'message_ids']) {
    const value = candidate.metadata[key];
    if (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string')) {
      return `${candidate.connector}:${[...value].sort().join(',')}`;
    }
  }
  return null;
}

function stableConversationKey(candidate: HybridCandidate): string | null {
  for (const key of [
    'chatId',
    'chat_id',
    'conversationId',
    'conversation_id',
    'threadId',
    'thread_id',
  ]) {
    const value = candidate.metadata[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

function dedupeKey(candidate: HybridCandidate): string {
  const conversationKey = stableConversationKey(candidate);
  return (
    stableMessageKey(candidate) ??
    (candidate.contentHash && conversationKey
      ? `conversation:${candidate.connector}:${conversationKey}:${candidate.contentHash}`
      : `chunk:${candidate.chunkId}`)
  );
}

/**
 * Weighted reciprocal-rank fusion with stable tie-breaking. The output is
 * deduplicated before source/document diversity caps are applied.
 */
export function rankHybridCandidates(
  vectorCandidates: HybridCandidate[],
  lexicalCandidates: HybridCandidate[],
  options: { limit: number; now: Date },
): RankedCandidate[] {
  const merged = new Map<string, HybridCandidate>();
  for (const candidate of [...vectorCandidates, ...lexicalCandidates]) {
    const current = merged.get(candidate.chunkId);
    if (!current) {
      merged.set(candidate.chunkId, { ...candidate });
      continue;
    }
    current.vectorScore ??= candidate.vectorScore;
    current.lexicalScore ??= candidate.lexicalScore;
  }

  const vectorRanks = new Map(
    vectorCandidates.map((candidate, index) => [candidate.chunkId, index + 1]),
  );
  const lexicalRanks = new Map(
    lexicalCandidates.map((candidate, index) => [candidate.chunkId, index + 1]),
  );
  const recencyOrdered = [...merged.values()]
    .map((candidate) => ({
      chunkId: candidate.chunkId,
      score: computeRecencyScore(candidate.occurredAt, candidate.recencyHalfLifeDays, options.now),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
  const recencyRanks = new Map(
    recencyOrdered.map((candidate, index) => [candidate.chunkId, index + 1]),
  );

  const ranked = [...merged.values()].map<RankedCandidate>((candidate) => {
    const vectorRank = vectorRanks.get(candidate.chunkId) ?? null;
    const lexicalRank = lexicalRanks.get(candidate.chunkId) ?? null;
    const recencyRank = recencyRanks.get(candidate.chunkId) ?? null;
    const recencyScore = computeRecencyScore(
      candidate.occurredAt,
      candidate.recencyHalfLifeDays,
      options.now,
    );
    const rrfVector =
      vectorRank === null
        ? 0
        : (VECTOR_WEIGHT * candidate.sourceWeight) / (HYBRID_RRF_K + vectorRank);
    const rrfLexical =
      lexicalRank === null
        ? 0
        : (LEXICAL_WEIGHT * candidate.sourceWeight) / (HYBRID_RRF_K + lexicalRank);
    const rrfRecency =
      recencyRank === null
        ? 0
        : (RECENCY_WEIGHT * candidate.sourceWeight) / (HYBRID_RRF_K + recencyRank);
    const fusedScore = rrfVector + rrfLexical + rrfRecency;
    const theoreticalBest =
      ((VECTOR_WEIGHT + LEXICAL_WEIGHT + RECENCY_WEIGHT) * candidate.sourceWeight) /
      (HYBRID_RRF_K + 1);
    return {
      ...candidate,
      recencyScore,
      vectorRank,
      lexicalRank,
      recencyRank,
      rrfVector,
      rrfLexical,
      rrfRecency,
      fusedScore,
      normalizedScore: theoreticalBest > 0 ? Math.min(1, fusedScore / theoreticalBest) : 0,
    };
  });

  ranked.sort(
    (a, b) =>
      b.fusedScore - a.fusedScore ||
      (a.vectorRank ?? Number.MAX_SAFE_INTEGER) - (b.vectorRank ?? Number.MAX_SAFE_INTEGER) ||
      (a.lexicalRank ?? Number.MAX_SAFE_INTEGER) - (b.lexicalRank ?? Number.MAX_SAFE_INTEGER) ||
      (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '') ||
      a.chunkId.localeCompare(b.chunkId),
  );

  const unique: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of ranked) {
    const key = dedupeKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  const sourceCount = new Set(unique.map((candidate) => candidate.sourceId)).size;
  const sourceCap = sourceCount <= 1 ? options.limit : Math.max(2, Math.ceil(options.limit / 2));
  const documentCap = 2;
  const sourceUses = new Map<string, number>();
  const documentUses = new Map<string, number>();
  const diversified: RankedCandidate[] = [];
  for (const candidate of unique) {
    if ((sourceUses.get(candidate.sourceId) ?? 0) >= sourceCap) continue;
    if ((documentUses.get(candidate.documentId) ?? 0) >= documentCap) continue;
    diversified.push(candidate);
    sourceUses.set(candidate.sourceId, (sourceUses.get(candidate.sourceId) ?? 0) + 1);
    documentUses.set(candidate.documentId, (documentUses.get(candidate.documentId) ?? 0) + 1);
    if (diversified.length >= options.limit) break;
  }
  return diversified;
}

function membershipConfigPredicate() {
  return sql`(
    ${brains.includeAllSources}
    or (
      case
        when jsonb_typeof(${brainSources.config}->'metadataFilters') = 'object'
          then ${knowledgeChunks.metadata} @> (${brainSources.config}->'metadataFilters')
        else true
      end
      and case
        when jsonb_typeof(${brainSources.config}->'enabledChunkKinds') = 'array'
          then (${brainSources.config}->'enabledChunkKinds') ? ${knowledgeChunks.kind}
        else true
      end
    )
  )`;
}

function scopeConditions(ctx: CoreCtx, brainId: string, options: BrainHybridSearchOptions) {
  const conditions = [
    eq(brains.id, brainId),
    eq(brains.orgId, ctx.tenantId),
    eq(knowledgeChunks.orgId, ctx.tenantId),
    eq(knowledgeDocuments.orgId, ctx.tenantId),
    eq(knowledgeSources.orgId, ctx.tenantId),
    eq(knowledgeDocuments.status, 'ready'),
    or(eq(brains.includeAllSources, true), isNotNull(brainSources.sourceId))!,
    membershipConfigPredicate(),
  ];
  if (options.sourceIds?.length) conditions.push(inArray(knowledgeSources.id, options.sourceIds));
  if (options.connectors?.length)
    conditions.push(inArray(knowledgeSources.connector, options.connectors));
  if (options.kinds?.length) conditions.push(inArray(knowledgeChunks.kind, options.kinds));
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    conditions.push(sql`${knowledgeChunks.metadata} @> ${JSON.stringify(options.metadata)}::jsonb`);
  }
  return and(...conditions);
}

function candidateSelection(retrievalScore: SQL<number>) {
  return {
    chunkId: knowledgeChunks.id,
    sourceId: knowledgeSources.id,
    sourceName: knowledgeSources.name,
    connector: knowledgeSources.connector,
    sourceExternalKey: knowledgeSources.externalKey,
    sourceConfig: knowledgeSources.config,
    documentId: knowledgeDocuments.id,
    documentExternalId: knowledgeDocuments.externalId,
    documentTitle: knowledgeDocuments.title,
    chunkKey: knowledgeChunks.chunkKey,
    kind: knowledgeChunks.kind,
    seq: knowledgeChunks.seq,
    chunkText: knowledgeChunks.chunkText,
    contextPrefix: knowledgeChunks.contextPrefix,
    contentHash: knowledgeChunks.contentHash,
    occurredAt: knowledgeChunks.occurredAt,
    metadata: knowledgeChunks.metadata,
    includeAllSources: brains.includeAllSources,
    membershipWeight: brainSources.weight,
    membershipConfig: brainSources.config,
    retrievalScore,
  };
}

async function retrieveVector(
  ctx: CoreCtx,
  brainId: string,
  query: string,
  options: BrainHybridSearchOptions,
  cap: number,
): Promise<HybridCandidate[]> {
  if (!embeddingsEnabled()) return [];
  const [embedding] = await embedTexts([query]);
  const literal = toVectorLiteral(embedding);
  const vectorDistance = sql<number>`${knowledgeChunks.embedding} <=> ${literal}::vector`;
  const vectorScore = sql<number>`1 - (${vectorDistance})`;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select(candidateSelection(vectorScore))
      .from(knowledgeChunks)
      .innerJoin(
        knowledgeDocuments,
        and(
          eq(knowledgeDocuments.id, knowledgeChunks.documentId),
          eq(knowledgeDocuments.sourceId, knowledgeChunks.sourceId),
        ),
      )
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
      .innerJoin(brains, and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .leftJoin(
        brainSources,
        and(
          eq(brainSources.brainId, brains.id),
          eq(brainSources.sourceId, knowledgeSources.id),
          eq(brainSources.orgId, ctx.tenantId),
        ),
      )
      .where(and(scopeConditions(ctx, brainId, options), isNotNull(knowledgeChunks.embedding)))
      .orderBy(vectorDistance)
      .limit(cap),
  );
  return (rows as CanonicalCandidateRow[]).map((row) => toCandidate(row, 'vector'));
}

async function retrieveLexical(
  ctx: CoreCtx,
  brainId: string,
  query: string,
  options: BrainHybridSearchOptions,
  cap: number,
): Promise<HybridCandidate[]> {
  const tsQuery = sql`websearch_to_tsquery('simple', ${query})`;
  const lexicalScore = sql<number>`ts_rank_cd(${knowledgeChunks.searchVector}, ${tsQuery}, 32)`;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select(candidateSelection(lexicalScore))
      .from(knowledgeChunks)
      .innerJoin(
        knowledgeDocuments,
        and(
          eq(knowledgeDocuments.id, knowledgeChunks.documentId),
          eq(knowledgeDocuments.sourceId, knowledgeChunks.sourceId),
        ),
      )
      .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
      .innerJoin(brains, and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .leftJoin(
        brainSources,
        and(
          eq(brainSources.brainId, brains.id),
          eq(brainSources.sourceId, knowledgeSources.id),
          eq(brainSources.orgId, ctx.tenantId),
        ),
      )
      .where(
        and(
          scopeConditions(ctx, brainId, options),
          sql`${knowledgeChunks.searchVector} @@ ${tsQuery}`,
        ),
      )
      .orderBy(sql`${lexicalScore} desc`, knowledgeChunks.id)
      .limit(cap),
  );
  return (rows as CanonicalCandidateRow[]).map((row) => toCandidate(row, 'lexical'));
}

async function loadNeighbors(
  ctx: CoreCtx,
  hits: RankedCandidate[],
  radius: number,
): Promise<NeighborRow[]> {
  if (hits.length === 0 || radius <= 0) return [];
  const windows = hits.map((hit) =>
    and(
      eq(knowledgeChunks.documentId, hit.documentId),
      gte(knowledgeChunks.seq, Math.max(0, hit.seq - radius)),
      lte(knowledgeChunks.seq, hit.seq + radius),
    ),
  );
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeChunks.documentId,
        chunkKey: knowledgeChunks.chunkKey,
        kind: knowledgeChunks.kind,
        seq: knowledgeChunks.seq,
        chunkText: knowledgeChunks.chunkText,
        contextPrefix: knowledgeChunks.contextPrefix,
      })
      .from(knowledgeChunks)
      .where(and(eq(knowledgeChunks.orgId, ctx.tenantId), or(...windows)))
      .orderBy(knowledgeChunks.documentId, knowledgeChunks.seq),
  );
  return rows as NeighborRow[];
}

export function attachNeighbors(
  ranked: RankedCandidate[],
  rows: NeighborRow[],
  radius: number,
): BrainHybridSearchHit[] {
  return ranked.map((candidate) => {
    const neighborhood = rows
      .filter(
        (row) =>
          row.documentId === candidate.documentId && Math.abs(row.seq - candidate.seq) <= radius,
      )
      .sort((a, b) => a.seq - b.seq);
    const neighbors = neighborhood
      .filter((row) => row.chunkId !== candidate.chunkId)
      .map<BrainEvidenceNeighbor>((row) => ({
        chunkId: row.chunkId,
        chunkKey: row.chunkKey,
        kind: row.kind,
        seq: row.seq,
        chunkText: row.chunkText,
        contextPrefix: row.contextPrefix,
      }));
    const expandedText =
      neighborhood.length > 0
        ? neighborhood.map((row) => row.chunkText).join('\n\n')
        : candidate.chunkText;
    return {
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      documentTitle: candidate.documentTitle,
      seq: candidate.seq,
      chunkText: candidate.chunkText,
      score: candidate.normalizedScore,
      sourceId: candidate.sourceId,
      sourceName: candidate.sourceName,
      connector: candidate.connector,
      sourceExternalKey: candidate.sourceExternalKey,
      documentExternalId: candidate.documentExternalId,
      chunkKey: candidate.chunkKey,
      kind: candidate.kind,
      contextPrefix: candidate.contextPrefix,
      occurredAt: candidate.occurredAt,
      metadata: candidate.metadata,
      citation: {
        sourceId: candidate.sourceId,
        sourceName: candidate.sourceName,
        connector: candidate.connector,
        sourceExternalKey: candidate.sourceExternalKey,
        documentId: candidate.documentId,
        documentExternalId: candidate.documentExternalId,
        documentTitle: candidate.documentTitle,
        occurredAt: candidate.occurredAt,
        metadata: candidate.metadata,
      },
      scores: {
        vector: candidate.vectorScore,
        lexical: candidate.lexicalScore,
        recency: candidate.recencyScore,
        rrf: {
          vector: candidate.rrfVector,
          lexical: candidate.rrfLexical,
          recency: candidate.rrfRecency,
        },
        fused: candidate.fusedScore,
        normalized: candidate.normalizedScore,
        sourceWeight: candidate.sourceWeight,
      },
      neighbors,
      expandedText,
    };
  });
}

function legacyHit(hit: Awaited<ReturnType<typeof searchBrain>>[number]): BrainHybridSearchHit {
  return {
    ...hit,
    sourceId: null,
    sourceName: null,
    connector: null,
    sourceExternalKey: null,
    documentExternalId: null,
    chunkKey: null,
    kind: null,
    contextPrefix: null,
    occurredAt: null,
    metadata: {},
    citation: {
      sourceId: null,
      sourceName: null,
      connector: null,
      sourceExternalKey: null,
      documentId: hit.documentId,
      documentExternalId: null,
      documentTitle: hit.documentTitle,
      occurredAt: null,
      metadata: {},
    },
    scores: {
      vector: hit.score,
      lexical: null,
      recency: 0,
      rrf: { vector: 0, lexical: 0, recency: 0 },
      fused: hit.score,
      normalized: hit.score,
      sourceWeight: 1,
    },
    neighbors: [],
    expandedText: hit.chunkText,
  };
}

/**
 * LLM-independent hybrid evidence primitive. Canonical retrieval degrades per
 * retriever and falls back to legacy `searchBrain` only when the shared corpus
 * yields no evidence, preserving the migration's dual-read guarantee.
 */
export async function searchBrainHybrid(
  ctx: CoreCtx,
  brainId: string,
  query: string,
  options: BrainHybridSearchOptions,
  principal: AccessPrincipal,
): Promise<BrainHybridSearchResult> {
  if (!(await canAccessBrain(ctx, brainId, 'read', principal)))
    throw error(403, 'no read access to this brain');
  const q = query.trim();
  if (!q) {
    return {
      mode: 'hybrid',
      hits: [],
      diagnostics: { vectorCandidates: 0, lexicalCandidates: 0, fusedCandidates: 0, warnings: [] },
    };
  }

  const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_LIMIT);
  const candidateCap = Math.min(Math.max(limit * 5, 20), MAX_CANDIDATES);
  const warnings: string[] = [];
  const [vectorResult, lexicalResult] = await Promise.allSettled([
    retrieveVector(ctx, brainId, q, options, candidateCap),
    retrieveLexical(ctx, brainId, q, options, candidateCap),
  ]);
  const vectorCandidates = vectorResult.status === 'fulfilled' ? vectorResult.value : [];
  const lexicalCandidates = lexicalResult.status === 'fulfilled' ? lexicalResult.value : [];
  if (vectorResult.status === 'rejected') warnings.push('vector retrieval unavailable');
  if (!embeddingsEnabled()) warnings.push('vector retrieval disabled');
  if (lexicalResult.status === 'rejected') warnings.push('lexical retrieval unavailable');

  const ranked = rankHybridCandidates(vectorCandidates, lexicalCandidates, {
    limit,
    now: options.now ?? new Date(),
  });
  if (ranked.length === 0) {
    const hits = (await searchBrain(ctx, brainId, q, limit, principal)).map(legacyHit);
    return {
      mode: 'legacy',
      hits,
      diagnostics: {
        vectorCandidates: vectorCandidates.length,
        lexicalCandidates: lexicalCandidates.length,
        fusedCandidates: 0,
        warnings,
      },
    };
  }

  const radius = Math.min(Math.max(options.neighborRadius ?? 1, 0), 3);
  let neighborRows: NeighborRow[] = [];
  try {
    neighborRows = await loadNeighbors(ctx, ranked, radius);
  } catch {
    warnings.push('neighbor expansion unavailable');
  }
  return {
    mode: 'hybrid',
    hits: attachNeighbors(ranked, neighborRows, radius),
    diagnostics: {
      vectorCandidates: vectorCandidates.length,
      lexicalCandidates: lexicalCandidates.length,
      fusedCandidates: ranked.length,
      warnings,
    },
  };
}
