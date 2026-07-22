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
/** ANN breadth applied transaction-locally before post-filtered vector search. */
export const HNSW_EF_SEARCH = 200;

const VECTOR_WEIGHT = 1;
const LEXICAL_WEIGHT = 1;
const TOKEN_MATCH_WEIGHT = 1.25;
const MAX_RECENCY_BOOST = 0.05;
const STRONG_SINGLE_TOKEN_VECTOR_SCORE = 0.35;
const MIN_SEMANTIC_VECTOR_SCORE = 0.12;
const DEFAULT_RECENCY_HALF_LIFE_DAYS = 180;
const CHAT_RECENCY_HALF_LIFE_DAYS = 90;
const MAX_CANDIDATES = 200;
const MAX_LIMIT = 50;
const SNIPPET_CHARS = 420;

const SCORE_SEMANTICS =
  'relative rank score within this result set; useful for ordering, not a probability or calibrated confidence';

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
  /** Query-centered excerpt. Full evidence remains in evidenceText. */
  chunkText: string;
  score: number;
  scoreSemantics: typeof SCORE_SEMANTICS | 'legacy cosine similarity; not a probability';
  confidence: null;
  matchBasis: BrainMatchDiagnostics['eligibility'];
  relevanceTier: 'anchored' | 'hybrid' | 'semantic' | 'legacy';
  snippet: string;
  evidenceText: string;

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
    rrf: { vector: number; lexical: number; tokenMatch: number };
    recencyBoost: number;
    fused: number;
    relative: number;
    /** Compatibility alias for clients already reading this field. */
    normalized: number;
    sourceWeight: number;
  };
  match: BrainMatchDiagnostics;
  neighbors: BrainEvidenceNeighbor[];
  expandedText: string;
}

export interface BrainMatchDiagnostics {
  queryTokens: string[];
  exactTokens: string[];
  fuzzyTokens: Array<{ queryToken: string; matchedToken: string; distance: number }>;
  exactTokenCoverage: number;
  fuzzyTokenCoverage: number;
  phraseMatch: boolean;
  lexicalMatched: boolean;
  vectorMatched: boolean;
  vectorOnly: boolean;
  eligibility: 'exact' | 'fuzzy' | 'hybrid' | 'semantic' | 'legacy';
  reasons: string[];
  snippetStrategy: 'exact_phrase' | 'exact_token' | 'fuzzy_token' | 'leading_context';
}

export interface BrainHybridSearchResult {
  mode: 'hybrid' | 'legacy';
  hits: BrainHybridSearchHit[];
  diagnostics: {
    vectorCandidates: number;
    lexicalCandidates: number;
    fusedCandidates: number;
    filteredCandidates: number;
    queryPolicy: 'single-token-anchored' | 'hybrid-semantic';
    queryTokens: string[];
    scoreSemantics: typeof SCORE_SEMANTICS | 'legacy cosine similarity; not a probability';
    emptyReason: 'empty_query' | 'no_canonical_candidates' | 'relevance_policy_filtered_all' | null;
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
  match: BrainMatchDiagnostics;
  recencyScore: number;
  vectorRank: number | null;
  lexicalRank: number | null;
  tokenMatchRank: number | null;
  rrfVector: number;
  rrfLexical: number;
  rrfTokenMatch: number;
  recencyBoost: number;
  fusedScore: number;
  relativeScore: number;
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

interface TokenWithOffset {
  value: string;
  start: number;
  end: number;
}

function normalizeToken(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function tokenizeQuery(value: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = normalizeToken(match[0]);
    if (token.length <= 1 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= 32) break;
  }
  return tokens;
}

function tokenizeWithOffsets(value: string): TokenWithOffset[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    value: normalizeToken(match[0]),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function editDistance(left: string, right: string, maxDistance: number): number {
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyDistanceLimit(token: string): number {
  if (token.length < 5) return 0;
  return token.length >= 9 ? 2 : 1;
}

function matchDiagnostics(
  queryTokens: string[],
  candidate: HybridCandidate,
  topVectorScore: number,
): BrainMatchDiagnostics | null {
  const textTokens = tokenizeWithOffsets(candidate.chunkText);
  const textTokenSet = new Set(textTokens.map((token) => token.value));
  const exactTokens = queryTokens.filter((token) => textTokenSet.has(token));
  const fuzzyTokens: BrainMatchDiagnostics['fuzzyTokens'] = [];
  for (const queryToken of queryTokens.length <= 3 ? queryTokens : []) {
    if (textTokenSet.has(queryToken)) continue;
    const maxDistance = fuzzyDistanceLimit(queryToken);
    if (maxDistance === 0) continue;
    let best: { token: string; distance: number } | null = null;
    for (const token of textTokenSet) {
      if (Math.abs(token.length - queryToken.length) > maxDistance) continue;
      const distance = editDistance(queryToken, token, maxDistance);
      if (distance <= maxDistance && (!best || distance < best.distance || token < best.token)) {
        best = { token, distance };
      }
    }
    if (best) fuzzyTokens.push({ queryToken, matchedToken: best.token, distance: best.distance });
  }

  const denominator = Math.max(queryTokens.length, 1);
  const exactTokenCoverage = exactTokens.length / denominator;
  const fuzzyTokenCoverage = fuzzyTokens.length / denominator;
  const normalizedText = textTokens.map((token) => token.value).join(' ');
  const phraseMatch = queryTokens.length > 0 && normalizedText.includes(queryTokens.join(' '));
  const lexicalMatched = candidate.lexicalScore !== null;
  const vectorMatched = candidate.vectorScore !== null;
  const vectorScore = candidate.vectorScore ?? Number.NEGATIVE_INFINITY;
  const reasons: string[] = [];
  let eligibility: BrainMatchDiagnostics['eligibility'] | null = null;

  if (phraseMatch || exactTokenCoverage === 1) {
    eligibility = 'exact';
    reasons.push(phraseMatch ? 'exact phrase present' : 'all query tokens present');
  } else if (queryTokens.length === 1 && fuzzyTokenCoverage === 1) {
    eligibility = 'fuzzy';
    reasons.push('single query token has a one-edit lexical neighbor');
  } else if (lexicalMatched || exactTokenCoverage >= 0.5 || fuzzyTokenCoverage >= 0.5) {
    eligibility = 'hybrid';
    reasons.push('lexical token evidence supports semantic retrieval');
  } else if (queryTokens.length === 1) {
    if (vectorScore >= STRONG_SINGLE_TOKEN_VECTOR_SCORE) {
      eligibility = 'semantic';
      reasons.push('single-token query has unusually strong vector similarity');
    }
  } else {
    const relativeFloor = Math.max(MIN_SEMANTIC_VECTOR_SCORE, topVectorScore - 0.12);
    if (vectorScore >= relativeFloor) {
      eligibility = 'semantic';
      reasons.push('multi-token semantic query passed the vector relevance floor');
    }
  }
  if (!eligibility) return null;

  return {
    queryTokens,
    exactTokens,
    fuzzyTokens,
    exactTokenCoverage,
    fuzzyTokenCoverage,
    phraseMatch,
    lexicalMatched,
    vectorMatched,
    vectorOnly:
      vectorMatched && !lexicalMatched && exactTokens.length === 0 && fuzzyTokens.length === 0,
    eligibility,
    reasons,
    snippetStrategy: phraseMatch
      ? 'exact_phrase'
      : exactTokens.length > 0
        ? 'exact_token'
        : fuzzyTokens.length > 0
          ? 'fuzzy_token'
          : 'leading_context',
  };
}

function querySnippet(
  text: string,
  match: BrainMatchDiagnostics,
  maxChars = SNIPPET_CHARS,
): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const textTokens = tokenizeWithOffsets(normalized);
  let anchor = 0;
  if (match.snippetStrategy === 'exact_phrase') {
    const phrase = match.queryTokens.join(' ');
    const phraseIndex = normalizeToken(normalized).indexOf(phrase);
    if (phraseIndex >= 0) anchor = phraseIndex;
  } else if (match.snippetStrategy === 'exact_token') {
    anchor = textTokens.find((token) => match.exactTokens.includes(token.value))?.start ?? 0;
  } else if (match.snippetStrategy === 'fuzzy_token') {
    const fuzzyMatches = new Set(match.fuzzyTokens.map((token) => token.matchedToken));
    anchor = textTokens.find((token) => fuzzyMatches.has(token.value))?.start ?? 0;
  }

  let start = Math.max(0, anchor - Math.floor(maxChars * 0.35));
  let end = Math.min(normalized.length, start + maxChars);
  if (start > 0) {
    const nextSpace = normalized.indexOf(' ', start);
    if (nextSpace >= 0 && nextSpace < end) start = nextSpace + 1;
  }
  if (end < normalized.length) {
    const previousSpace = normalized.lastIndexOf(' ', end);
    if (previousSpace > start) end = previousSpace;
  }
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

function relevanceTier(
  eligibility: BrainMatchDiagnostics['eligibility'],
): BrainHybridSearchHit['relevanceTier'] {
  if (eligibility === 'exact' || eligibility === 'fuzzy') return 'anchored';
  if (eligibility === 'hybrid') return 'hybrid';
  if (eligibility === 'semantic') return 'semantic';
  return 'legacy';
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
  options: { limit: number; now: Date; query: string },
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
  const queryTokens = tokenizeQuery(options.query);
  const topVectorScore = Math.max(
    ...vectorCandidates.map((candidate) => candidate.vectorScore ?? Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY,
  );
  const eligible = [...merged.values()]
    .map((candidate) => ({
      candidate,
      match: matchDiagnostics(queryTokens, candidate, topVectorScore),
    }))
    .filter(
      (entry): entry is { candidate: HybridCandidate; match: BrainMatchDiagnostics } =>
        entry.match !== null,
    );
  const tokenMatchOrdered = [...eligible]
    .filter(
      ({ match }) =>
        match.phraseMatch || match.exactTokenCoverage > 0 || match.fuzzyTokenCoverage > 0,
    )
    .sort(
      (a, b) =>
        Number(b.match.phraseMatch) - Number(a.match.phraseMatch) ||
        b.match.exactTokenCoverage - a.match.exactTokenCoverage ||
        b.match.fuzzyTokenCoverage - a.match.fuzzyTokenCoverage ||
        (b.candidate.lexicalScore ?? 0) - (a.candidate.lexicalScore ?? 0) ||
        a.candidate.chunkId.localeCompare(b.candidate.chunkId),
    );
  const tokenMatchRanks = new Map(
    tokenMatchOrdered.map(({ candidate }, index) => [candidate.chunkId, index + 1]),
  );

  const ranked = eligible.map<RankedCandidate>(({ candidate, match }) => {
    const vectorRank = vectorRanks.get(candidate.chunkId) ?? null;
    const lexicalRank = lexicalRanks.get(candidate.chunkId) ?? null;
    const tokenMatchRank = tokenMatchRanks.get(candidate.chunkId) ?? null;
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
    const rrfTokenMatch =
      tokenMatchRank === null
        ? 0
        : (TOKEN_MATCH_WEIGHT * candidate.sourceWeight) / (HYBRID_RRF_K + tokenMatchRank);
    const relevanceScore = rrfVector + rrfLexical + rrfTokenMatch;
    // Freshness can refine relevant evidence, but can never create relevance.
    const recencyBoost = relevanceScore * MAX_RECENCY_BOOST * recencyScore;
    const fusedScore = relevanceScore + recencyBoost;
    return {
      ...candidate,
      match,
      recencyScore,
      vectorRank,
      lexicalRank,
      tokenMatchRank,
      rrfVector,
      rrfLexical,
      rrfTokenMatch,
      recencyBoost,
      fusedScore,
      relativeScore: 0,
    };
  });

  ranked.sort(
    (a, b) =>
      b.fusedScore - a.fusedScore ||
      (a.tokenMatchRank ?? Number.MAX_SAFE_INTEGER) -
        (b.tokenMatchRank ?? Number.MAX_SAFE_INTEGER) ||
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
  const bestScore = diversified[0]?.fusedScore ?? 0;
  for (const candidate of diversified) {
    candidate.relativeScore = bestScore > 0 ? candidate.fusedScore / bestScore : 0;
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

/** Sources without a sensitivity classification are general knowledge.
 * Classified sources require safe source-wide module access and a sufficient
 * field level; malformed classifications fail closed. */
export function sourceAccessPredicate(
  searchableModules: string[],
  fieldLevels: Record<string, number>,
): SQL {
  const requiredModule = sql`nullif(${knowledgeSources.config}->>'requiredModule', '')`;
  const requiredFieldLevel = sql`case
    when nullif(${knowledgeSources.config}->>'requiredFieldLevel', '') is null then 0
    when (${knowledgeSources.config}->>'requiredFieldLevel') ~ '^[0-9]+$'
      then (${knowledgeSources.config}->>'requiredFieldLevel')::integer
    else 2147483647
  end`;
  const generalKnowledge = sql`(${requiredModule} is null and ${requiredFieldLevel} <= 0)`;
  const allowedModules = [...new Set(searchableModules.filter(Boolean))];
  if (allowedModules.length === 0) return generalKnowledge;
  const classifiedAccess = allowedModules.map((module) => {
    const rawLevel = fieldLevels[module] ?? 0;
    const fieldLevel = Number.isFinite(rawLevel) ? Math.max(0, Math.floor(rawLevel)) : 0;
    return sql`(${requiredModule} = ${module} and ${requiredFieldLevel} <= ${fieldLevel})`;
  });
  return sql`(${generalKnowledge} or ${sql.join(classifiedAccess, sql` or `)})`;
}

/** Keep the ANN breadth scoped to the current RLS transaction/connection. */
export function hnswSearchConfigSql(): SQL {
  return sql`set local hnsw.ef_search = ${sql.raw(String(HNSW_EF_SEARCH))}`;
}

function scopeConditions(
  ctx: CoreCtx,
  brainId: string,
  options: BrainHybridSearchOptions,
  searchableModules: string[],
  fieldLevels: Record<string, number>,
) {
  const conditions = [
    eq(brains.id, brainId),
    eq(brains.orgId, ctx.tenantId),
    eq(knowledgeChunks.orgId, ctx.tenantId),
    eq(knowledgeDocuments.orgId, ctx.tenantId),
    eq(knowledgeSources.orgId, ctx.tenantId),
    eq(knowledgeDocuments.status, 'ready'),
    or(eq(brains.includeAllSources, true), isNotNull(brainSources.sourceId))!,
    membershipConfigPredicate(),
    sourceAccessPredicate(searchableModules, fieldLevels),
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

/** Exported for SQL-shape regression coverage: neighbor expansion must retain
 * the exact source membership, module, kind, and metadata scope used by retrieval. */
export function neighborScopeConditions(
  ctx: CoreCtx,
  brainId: string,
  options: BrainHybridSearchOptions,
  searchableModules: string[],
  fieldLevels: Record<string, number>,
): SQL {
  return scopeConditions(ctx, brainId, options, searchableModules, fieldLevels)!;
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
  searchableModules: string[],
  fieldLevels: Record<string, number>,
  cap: number,
): Promise<HybridCandidate[]> {
  if (!embeddingsEnabled()) return [];
  const [embedding] = await embedTexts([query]);
  const literal = toVectorLiteral(embedding);
  const vectorDistance = sql<number>`${knowledgeChunks.embedding} <=> ${literal}::vector`;
  const vectorScore = sql<number>`1 - (${vectorDistance})`;
  const rows = await withOrgCore(ctx, async (tx) => {
    await tx.execute(hnswSearchConfigSql());
    return tx
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
      .where(
        and(
          scopeConditions(ctx, brainId, options, searchableModules, fieldLevels),
          isNotNull(knowledgeChunks.embedding),
        ),
      )
      .orderBy(vectorDistance)
      .limit(cap);
  });
  return (rows as CanonicalCandidateRow[]).map((row) => toCandidate(row, 'vector'));
}

async function retrieveLexical(
  ctx: CoreCtx,
  brainId: string,
  query: string,
  options: BrainHybridSearchOptions,
  searchableModules: string[],
  fieldLevels: Record<string, number>,
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
          scopeConditions(ctx, brainId, options, searchableModules, fieldLevels),
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
  brainId: string,
  hits: RankedCandidate[],
  radius: number,
  options: BrainHybridSearchOptions,
  searchableModules: string[],
  fieldLevels: Record<string, number>,
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
          neighborScopeConditions(ctx, brainId, options, searchableModules, fieldLevels),
          or(...windows),
        ),
      )
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
    const snippet = querySnippet(candidate.chunkText, candidate.match);
    return {
      chunkId: candidate.chunkId,
      documentId: candidate.documentId,
      documentTitle: candidate.documentTitle,
      seq: candidate.seq,
      chunkText: snippet,
      score: candidate.relativeScore,
      scoreSemantics: SCORE_SEMANTICS,
      confidence: null,
      matchBasis: candidate.match.eligibility,
      relevanceTier: relevanceTier(candidate.match.eligibility),
      snippet,
      evidenceText: candidate.chunkText,
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
          tokenMatch: candidate.rrfTokenMatch,
        },
        recencyBoost: candidate.recencyBoost,
        fused: candidate.fusedScore,
        relative: candidate.relativeScore,
        normalized: candidate.relativeScore,
        sourceWeight: candidate.sourceWeight,
      },
      match: candidate.match,
      neighbors,
      expandedText,
    };
  });
}

function legacyHit(
  hit: Awaited<ReturnType<typeof searchBrain>>[number],
  query: string,
): BrainHybridSearchHit {
  const queryTokens = tokenizeQuery(query);
  const provisional = matchDiagnostics(
    queryTokens,
    {
      chunkId: hit.chunkId,
      sourceId: '',
      sourceName: '',
      connector: '',
      sourceExternalKey: '',
      documentId: hit.documentId,
      documentExternalId: '',
      documentTitle: hit.documentTitle,
      chunkKey: '',
      kind: 'raw',
      seq: hit.seq,
      chunkText: hit.chunkText,
      contextPrefix: null,
      contentHash: '',
      occurredAt: null,
      metadata: {},
      sourceWeight: 1,
      recencyHalfLifeDays: DEFAULT_RECENCY_HALF_LIFE_DAYS,
      vectorScore: hit.score,
      lexicalScore: null,
    },
    hit.score,
  );
  const match: BrainMatchDiagnostics = provisional ?? {
    queryTokens,
    exactTokens: [],
    fuzzyTokens: [],
    exactTokenCoverage: 0,
    fuzzyTokenCoverage: 0,
    phraseMatch: false,
    lexicalMatched: false,
    vectorMatched: true,
    vectorOnly: true,
    eligibility: 'legacy',
    reasons: ['legacy vector-only compatibility result'],
    snippetStrategy: 'leading_context',
  };
  const snippet = querySnippet(hit.chunkText, match);
  return {
    ...hit,
    chunkText: snippet,
    scoreSemantics: 'legacy cosine similarity; not a probability',
    confidence: null,
    matchBasis: match.eligibility,
    relevanceTier: relevanceTier(match.eligibility),
    snippet,
    evidenceText: hit.chunkText,
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
      rrf: { vector: 0, lexical: 0, tokenMatch: 0 },
      recencyBoost: 0,
      fused: hit.score,
      relative: hit.score,
      normalized: hit.score,
      sourceWeight: 1,
    },
    match,
    neighbors: [],
    expandedText: hit.chunkText,
  };
}

/**
 * LLM-independent hybrid evidence primitive. Canonical retrieval degrades per
 * retriever and falls back to legacy `searchBrain` only when canonical retrieval
 * yields no candidates. Candidates rejected by relevance policy return an
 * explicit empty result instead of bypassing the policy through legacy noise.
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
  const queryTokens = tokenizeQuery(q);
  const queryPolicy = queryTokens.length === 1 ? 'single-token-anchored' : 'hybrid-semantic';
  if (!q) {
    return {
      mode: 'hybrid',
      hits: [],
      diagnostics: {
        vectorCandidates: 0,
        lexicalCandidates: 0,
        fusedCandidates: 0,
        filteredCandidates: 0,
        queryPolicy,
        queryTokens,
        scoreSemantics: SCORE_SEMANTICS,
        emptyReason: 'empty_query',
        warnings: [],
      },
    };
  }

  const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_LIMIT);
  const candidateCap = Math.min(
    Math.max(limit * 5, queryTokens.length === 1 ? 100 : 20),
    MAX_CANDIDATES,
  );
  const warnings: string[] = [];
  const searchableModules = principal.searchableModules ?? [];
  const fieldLevels = principal.fieldLevels ?? {};
  const [vectorResult, lexicalResult] = await Promise.allSettled([
    retrieveVector(ctx, brainId, q, options, searchableModules, fieldLevels, candidateCap),
    retrieveLexical(ctx, brainId, q, options, searchableModules, fieldLevels, candidateCap),
  ]);
  const vectorCandidates = vectorResult.status === 'fulfilled' ? vectorResult.value : [];
  const lexicalCandidates = lexicalResult.status === 'fulfilled' ? lexicalResult.value : [];
  if (vectorResult.status === 'rejected') warnings.push('vector retrieval unavailable');
  if (!embeddingsEnabled()) warnings.push('vector retrieval disabled');
  if (lexicalResult.status === 'rejected') warnings.push('lexical retrieval unavailable');

  const ranked = rankHybridCandidates(vectorCandidates, lexicalCandidates, {
    limit,
    now: options.now ?? new Date(),
    query: q,
  });
  const retrievedCandidates = new Set(
    [...vectorCandidates, ...lexicalCandidates].map((candidate) => candidate.chunkId),
  ).size;
  const policyFilteredAll = ranked.length === 0 && retrievedCandidates > 0;
  if (policyFilteredAll) warnings.push('all canonical candidates rejected by relevance policy');
  if (ranked.length === 0 && retrievedCandidates === 0) {
    const legacyFallbackAllowed = principal.roles?.some(
      (role) => role === 'owner' || role === 'admin',
    );
    if (legacyFallbackAllowed) {
      const hits = (await searchBrain(ctx, brainId, q, limit, principal)).map((hit) =>
        legacyHit(hit, q),
      );
      return {
        mode: 'legacy',
        hits,
        diagnostics: {
          vectorCandidates: vectorCandidates.length,
          lexicalCandidates: lexicalCandidates.length,
          fusedCandidates: 0,
          filteredCandidates: 0,
          queryPolicy,
          queryTokens,
          scoreSemantics: 'legacy cosine similarity; not a probability',
          emptyReason: hits.length === 0 ? 'no_canonical_candidates' : null,
          warnings,
        },
      };
    }
    warnings.push('legacy fallback unavailable for scoped principal');
    return {
      mode: 'hybrid',
      hits: [],
      diagnostics: {
        vectorCandidates: vectorCandidates.length,
        lexicalCandidates: lexicalCandidates.length,
        fusedCandidates: 0,
        filteredCandidates: 0,
        queryPolicy,
        queryTokens,
        scoreSemantics: SCORE_SEMANTICS,
        emptyReason: 'no_canonical_candidates',
        warnings,
      },
    };
  }

  const radius = Math.min(Math.max(options.neighborRadius ?? 1, 0), 3);
  let neighborRows: NeighborRow[] = [];
  try {
    neighborRows = await loadNeighbors(
      ctx,
      brainId,
      ranked,
      radius,
      options,
      searchableModules,
      fieldLevels,
    );
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
      filteredCandidates: Math.max(0, retrievedCandidates - ranked.length),
      queryPolicy,
      queryTokens,
      scoreSemantics: SCORE_SEMANTICS,
      emptyReason: policyFilteredAll ? 'relevance_policy_filtered_all' : null,
      warnings,
    },
  };
}
