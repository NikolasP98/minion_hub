import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  canAccessBrain: vi.fn(),
  searchBrain: vi.fn(),
  withOrgCore: vi.fn(),
  embeddingsEnabled: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock('./brains.service', () => ({
  canAccessBrain: mocks.canAccessBrain,
  searchBrain: mocks.searchBrain,
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: mocks.withOrgCore,
}));

vi.mock('./embeddings', () => ({
  embeddingsEnabled: mocks.embeddingsEnabled,
  embedTexts: mocks.embedTexts,
  toVectorLiteral: (vector: number[]) => `[${vector.join(',')}]`,
}));

import {
  HNSW_EF_SEARCH,
  HYBRID_RRF_K,
  attachNeighbors,
  computeRecencyScore,
  hnswSearchConfigSql,
  neighborScopeConditions,
  rankHybridCandidates,
  searchBrainHybrid,
  sourceAccessPredicate,
  type HybridCandidate,
} from './brain-hybrid-retrieval.service';

const NOW = new Date('2026-07-21T12:00:00.000Z');

function candidate(overrides: Partial<HybridCandidate> = {}): HybridCandidate {
  return {
    chunkId: 'chunk-1',
    sourceId: 'source-1',
    sourceName: 'WhatsApp +51999',
    connector: 'whatsapp',
    sourceExternalKey: 'account-1',
    documentId: 'document-1',
    documentExternalId: 'whatsapp:account-1:chat-1',
    documentTitle: 'Conversation with Ada',
    chunkKey: 'turns:0',
    kind: 'raw',
    seq: 1,
    chunkText: 'Ada asked about the refund policy.',
    contextPrefix: null,
    contentHash: 'hash-1',
    occurredAt: '2026-07-20T12:00:00.000Z',
    metadata: {},
    sourceWeight: 1,
    recencyHalfLifeDays: 90,
    vectorScore: 0.9,
    lexicalScore: null,
    ...overrides,
  };
}

describe('brain hybrid retrieval — deterministic scoring', () => {
  it('sets a transaction-local HNSW breadth before post-filtered vector retrieval', () => {
    const query = new PgDialect().sqlToQuery(hnswSearchConfigSql());

    expect(HNSW_EF_SEARCH).toBe(200);
    expect(query.sql).toBe('set local hnsw.ef_search = 200');
    expect(query.params).toEqual([]);
  });

  it('fails classified source access closed unless its required module is visible', () => {
    const dialect = new PgDialect();
    const denied = dialect.sqlToQuery(sourceAccessPredicate([], {}));
    const allowed = dialect.sqlToQuery(
      sourceAccessPredicate(['crm', 'finance'], { crm: 0, finance: 1 }),
    );

    expect(denied.sql).toContain("->>'requiredModule'");
    expect(denied.sql).toContain("->>'requiredFieldLevel'");
    expect(denied.sql).toContain('is null');
    expect(allowed.sql).toContain('::integer');
    expect(allowed.params).toEqual(['crm', 0, 'finance', 1]);
  });

  it('reapplies focused membership plus caller kind and metadata filters to neighbors', () => {
    const query = new PgDialect().sqlToQuery(
      neighborScopeConditions(
        { db: {} as never, tenantId: 'org-1' },
        '11111111-1111-4111-8111-111111111111',
        {
          sourceIds: ['22222222-2222-4222-8222-222222222222'],
          connectors: ['whatsapp'],
          kinds: ['raw'],
          metadata: { sensitivity: 'public' },
        },
        ['crm'],
        { crm: 1 },
      ),
    );

    expect(query.sql).toContain('"brain_sources"."config"->\'metadataFilters\'');
    expect(query.sql).toContain('"brain_sources"."config"->\'enabledChunkKinds\'');
    expect(query.sql).toContain('"knowledge_chunks"."kind" in');
    expect(query.sql).toContain('"knowledge_chunks"."metadata" @>');
    expect(query.params).toEqual(
      expect.arrayContaining([
        'org-1',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        'whatsapp',
        'raw',
        JSON.stringify({ sensitivity: 'public' }),
      ]),
    );
  });

  it('uses k=60 weighted reciprocal-rank fusion', () => {
    const both = candidate({ chunkId: 'both', contentHash: 'both' });
    const vectorOnly = candidate({ chunkId: 'vector-only', contentHash: 'vector-only' });
    const lexicalOnly = candidate({
      chunkId: 'lexical-only',
      contentHash: 'lexical-only',
      vectorScore: null,
      lexicalScore: 0.8,
    });

    const ranked = rankHybridCandidates(
      [both, vectorOnly],
      [lexicalOnly, { ...both, vectorScore: null, lexicalScore: 0.7 }],
      { limit: 10, now: NOW, query: 'refund policy' },
    );

    expect(HYBRID_RRF_K).toBe(60);
    expect(ranked[0].chunkId).toBe('both');
    expect(ranked[0].rrfVector).toBeCloseTo(1 / 61);
    expect(ranked[0].rrfLexical).toBeCloseTo(1 / 62);
    expect(ranked[0].fusedScore).toBeCloseTo(
      ranked[0].rrfVector + ranked[0].rrfLexical + ranked[0].rrfTokenMatch + ranked[0].recencyBoost,
    );
  });

  it('computes deterministic half-life recency without rewarding future timestamps', () => {
    expect(computeRecencyScore('2026-07-11T12:00:00.000Z', 10, NOW)).toBeCloseTo(0.5);
    expect(computeRecencyScore('2026-08-01T00:00:00.000Z', 10, NOW)).toBe(1);
    expect(computeRecencyScore(null, 10, NOW)).toBe(0);
  });

  it('deduplicates relinked content and caps a document at two final contributions', () => {
    const repeated = candidate({
      chunkId: 'repeat',
      documentId: 'relinked',
      contentHash: 'same-transcript',
      metadata: { chatId: 'chat-1' },
    });
    const rows = [
      candidate({
        chunkId: 'a',
        seq: 0,
        contentHash: 'same-transcript',
        metadata: { chatId: 'chat-1' },
      }),
      repeated,
      candidate({ chunkId: 'b', seq: 1, contentHash: 'hash-b' }),
      candidate({ chunkId: 'c', seq: 2, contentHash: 'hash-c' }),
      candidate({ chunkId: 'd', documentId: 'document-2', seq: 0, contentHash: 'hash-d' }),
    ];
    const ranked = rankHybridCandidates(rows, [], { limit: 10, now: NOW, query: 'refund policy' });

    expect(ranked.filter((row) => row.contentHash === 'same-transcript')).toHaveLength(1);
    expect(ranked.filter((row) => row.documentId === 'document-1')).toHaveLength(2);
    expect(ranked.some((row) => row.documentId === 'document-2')).toBe(true);
  });

  it('caps each source when multiple sources can answer', () => {
    const rows = Array.from({ length: 10 }, (_, index) => {
      const sourceNumber = index < 5 ? 1 : 2;
      return candidate({
        chunkId: `chunk-${index}`,
        sourceId: `source-${sourceNumber}`,
        documentId: `document-${index}`,
        contentHash: `hash-${index}`,
      });
    });
    const ranked = rankHybridCandidates(rows, [], { limit: 6, now: NOW, query: 'refund policy' });
    const bySource = Map.groupBy(ranked, (row) => row.sourceId);

    expect(ranked).toHaveLength(6);
    expect(bySource.get('source-1')).toHaveLength(3);
    expect(bySource.get('source-2')).toHaveLength(3);
  });

  it('expands immediate neighbors only after final ranking', () => {
    const [ranked] = rankHybridCandidates([candidate()], [], {
      limit: 1,
      now: NOW,
      query: 'refund policy',
    });
    const hits = attachNeighbors(
      [ranked],
      [
        {
          chunkId: 'before',
          documentId: 'document-1',
          chunkKey: 'turns:0',
          kind: 'raw',
          seq: 0,
          chunkText: 'Before',
          contextPrefix: null,
        },
        {
          chunkId: 'chunk-1',
          documentId: 'document-1',
          chunkKey: 'turns:1',
          kind: 'raw',
          seq: 1,
          chunkText: 'Match',
          contextPrefix: null,
        },
        {
          chunkId: 'after',
          documentId: 'document-1',
          chunkKey: 'turns:2',
          kind: 'raw',
          seq: 2,
          chunkText: 'After',
          contextPrefix: null,
        },
        {
          chunkId: 'far',
          documentId: 'document-1',
          chunkKey: 'turns:3',
          kind: 'raw',
          seq: 3,
          chunkText: 'Far',
          contextPrefix: null,
        },
      ],
      1,
    );

    expect(hits[0].neighbors.map((row) => row.chunkId)).toEqual(['before', 'after']);
    expect(hits[0].expandedText).toBe('Before\n\nMatch\n\nAfter');
    expect(hits[0].chunkText).toBe('Ada asked about the refund policy.');
  });

  it('keeps a fuzzy entity hit and rejects stronger but unsupported vector neighbors', () => {
    const fuzzyHit = candidate({
      chunkId: 'krispi',
      chunkText: `${'unrelated history '.repeat(40)}Agent: Sw ve KRISPI Customer: Es al PANKO`,
      vectorScore: 0.14,
    });
    const unrelated = candidate({
      chunkId: 'unrelated',
      chunkText: 'A conversation about snacks and fruit.',
      vectorScore: 0.23,
    });

    const ranked = rankHybridCandidates([unrelated, fuzzyHit], [], {
      limit: 10,
      now: NOW,
      query: 'krispy',
    });
    const hits = attachNeighbors(ranked, [], 1);

    expect(ranked.map((row) => row.chunkId)).toEqual(['krispi']);
    expect(ranked[0].match.eligibility).toBe('fuzzy');
    expect(ranked[0].match.fuzzyTokens).toEqual([
      { queryToken: 'krispy', matchedToken: 'krispi', distance: 1 },
    ]);
    expect(hits[0].chunkText).toContain('KRISPI');
    expect(hits[0].chunkText).not.toMatch(/^unrelated history/);
    expect(hits[0].evidenceText.length).toBeGreaterThan(hits[0].chunkText.length);
    expect(hits[0]).toMatchObject({ matchBasis: 'fuzzy', relevanceTier: 'anchored' });
  });

  it('ranks exact lexical entity evidence ahead of a strong vector-only candidate', () => {
    const exact = candidate({
      chunkId: 'exact',
      chunkText: 'Customer asked for Krispy delivery.',
      vectorScore: 0.4,
      lexicalScore: 0.5,
    });
    const semantic = candidate({
      chunkId: 'semantic',
      chunkText: 'Customer discussed dessert delivery.',
      vectorScore: 0.8,
    });
    const ranked = rankHybridCandidates([semantic, exact], [{ ...exact, vectorScore: null }], {
      limit: 10,
      now: NOW,
      query: 'krispy',
    });

    expect(ranked[0].chunkId).toBe('exact');
    expect(ranked[0].match.eligibility).toBe('exact');
    expect(ranked[1].match.eligibility).toBe('semantic');
  });

  it('preserves vector-only retrieval for a multi-token semantic query', () => {
    const semantic = candidate({
      chunkId: 'semantic',
      chunkText: 'El cliente estaba molesto porque su pedido llegó tarde.',
      vectorScore: 0.31,
    });
    const ranked = rankHybridCandidates([semantic], [], {
      limit: 10,
      now: NOW,
      query: 'customers unhappy about shipping delays',
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].match).toMatchObject({ eligibility: 'semantic', vectorOnly: true });
  });

  it('centers a common-word snippet on the query instead of returning a whole transcript', () => {
    const exact = candidate({
      chunkId: 'como',
      chunkText: `${'old transcript '.repeat(80)}Customer: como hacemos el envío? ${'later transcript '.repeat(80)}Agent: KRISPI`,
      vectorScore: 0.2,
      lexicalScore: 0.4,
    });
    const ranked = rankHybridCandidates([exact], [exact], {
      limit: 1,
      now: NOW,
      query: 'como',
    });
    const [hit] = attachNeighbors(ranked, [], 1);

    expect(hit.chunkText).toContain('como hacemos el envío');
    expect(hit.chunkText).not.toContain('KRISPI');
    expect(hit.chunkText.length).toBeLessThanOrEqual(422);
    expect(hit.scoreSemantics).toContain('not a probability');
    expect(hit.confidence).toBeNull();
  });
});

describe('brain hybrid retrieval — canonical/legacy compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessBrain.mockResolvedValue(true);
    mocks.embeddingsEnabled.mockReturnValue(false);
    mocks.withOrgCore.mockResolvedValue([]);
    mocks.searchBrain.mockResolvedValue([]);
  });

  it('falls back to existing searchBrain when the canonical corpus has no hits', async () => {
    mocks.searchBrain.mockResolvedValueOnce([
      {
        chunkId: 'legacy-chunk',
        documentId: 'legacy-document',
        documentTitle: 'Legacy note',
        seq: 0,
        chunkText: 'Existing embedded content',
        score: 0.88,
      },
    ]);

    const result = await searchBrainHybrid(
      { db: {} as never, tenantId: 'org-1' },
      '11111111-1111-4111-8111-111111111111',
      'refund policy',
      { limit: 5 },
      { roles: ['owner'] },
    );

    expect(result.mode).toBe('legacy');
    expect(result.hits[0]).toMatchObject({
      chunkId: 'legacy-chunk',
      sourceId: null,
      expandedText: 'Existing embedded content',
    });
    expect(mocks.searchBrain).toHaveBeenCalledOnce();
  });

  it('returns canonical lexical evidence without calling the legacy search', async () => {
    mocks.withOrgCore
      .mockResolvedValueOnce([
        {
          chunkId: 'canonical-chunk',
          sourceId: '22222222-2222-4222-8222-222222222222',
          sourceName: 'WhatsApp +51999',
          connector: 'whatsapp',
          sourceExternalKey: 'account-1',
          sourceConfig: {},
          documentId: '33333333-3333-4333-8333-333333333333',
          documentExternalId: 'whatsapp:account-1:chat-1',
          documentTitle: 'Conversation with Ada',
          chunkKey: 'turns:0',
          kind: 'raw',
          seq: 0,
          chunkText: 'Refund policy evidence',
          contextPrefix: null,
          contentHash: 'canonical-hash',
          occurredAt: NOW,
          metadata: { chatId: 'chat-1' },
          includeAllSources: true,
          membershipWeight: null,
          membershipConfig: null,
          retrievalScore: 0.6,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await searchBrainHybrid(
      { db: {} as never, tenantId: 'org-1' },
      '11111111-1111-4111-8111-111111111111',
      'refund policy',
      { limit: 5 },
      {},
    );

    expect(result.mode).toBe('hybrid');
    expect(result.hits[0]).toMatchObject({
      chunkId: 'canonical-chunk',
      connector: 'whatsapp',
      sourceExternalKey: 'account-1',
      documentExternalId: 'whatsapp:account-1:chat-1',
    });
    expect(result.hits[0].scores.lexical).toBe(0.6);
    expect(mocks.searchBrain).not.toHaveBeenCalled();
  });

  it('does not bypass relevance policy through legacy fallback after rejecting canonical noise', async () => {
    mocks.embeddingsEnabled.mockReturnValue(true);
    mocks.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);
    // Lexical starts immediately; vector reaches the DB after awaiting the embedding.
    mocks.withOrgCore.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        chunkId: 'noise',
        sourceId: '22222222-2222-4222-8222-222222222222',
        sourceName: 'WhatsApp +51999',
        connector: 'whatsapp',
        sourceExternalKey: 'account-1',
        sourceConfig: {},
        documentId: '33333333-3333-4333-8333-333333333333',
        documentExternalId: 'whatsapp:account-1:chat-1',
        documentTitle: 'Unrelated conversation',
        chunkKey: 'turns:0',
        kind: 'raw',
        seq: 0,
        chunkText: 'This content has no matching entity token.',
        contextPrefix: null,
        contentHash: 'noise-hash',
        occurredAt: NOW,
        metadata: { chatId: 'chat-1' },
        includeAllSources: true,
        membershipWeight: null,
        membershipConfig: null,
        retrievalScore: 0.2,
      },
    ]);

    const result = await searchBrainHybrid(
      { db: {} as never, tenantId: 'org-1' },
      '11111111-1111-4111-8111-111111111111',
      'krispy',
      { limit: 5 },
      { searchableModules: ['brains'], fieldLevels: { brains: 0 } },
    );

    expect(result).toMatchObject({
      mode: 'hybrid',
      hits: [],
      diagnostics: {
        queryPolicy: 'single-token-anchored',
        filteredCandidates: 1,
        emptyReason: 'relevance_policy_filtered_all',
        scoreSemantics: expect.stringContaining('not a probability'),
        warnings: ['all canonical candidates rejected by relevance policy'],
      },
    });
    expect(mocks.searchBrain).not.toHaveBeenCalled();
  });

  it('fails closed instead of using unclassified legacy chunks for a scoped role', async () => {
    mocks.searchBrain.mockResolvedValueOnce([
      {
        chunkId: 'legacy-sensitive',
        documentId: 'legacy-document',
        documentTitle: 'Legacy conversation',
        seq: 0,
        chunkText: 'Unclassified sensitive evidence',
        score: 0.9,
      },
    ]);

    const result = await searchBrainHybrid(
      { db: {} as never, tenantId: 'org-1' },
      '11111111-1111-4111-8111-111111111111',
      'sensitive query',
      { limit: 5 },
      { roles: ['staff'], searchableModules: ['crm'], fieldLevels: { crm: 0 } },
    );

    expect(result).toMatchObject({
      mode: 'hybrid',
      hits: [],
      diagnostics: {
        emptyReason: 'no_canonical_candidates',
        warnings: expect.arrayContaining(['legacy fallback unavailable for scoped principal']),
      },
    });
    expect(mocks.searchBrain).not.toHaveBeenCalled();
  });
});
