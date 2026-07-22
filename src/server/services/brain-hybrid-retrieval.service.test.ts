import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  HYBRID_RRF_K,
  attachNeighbors,
  computeRecencyScore,
  rankHybridCandidates,
  searchBrainHybrid,
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
      { limit: 10, now: NOW },
    );

    expect(HYBRID_RRF_K).toBe(60);
    expect(ranked[0].chunkId).toBe('both');
    expect(ranked[0].rrfVector).toBeCloseTo(1 / 61);
    expect(ranked[0].rrfLexical).toBeCloseTo(0.85 / 62);
    expect(ranked[0].fusedScore).toBeCloseTo(
      ranked[0].rrfVector + ranked[0].rrfLexical + ranked[0].rrfRecency,
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
    const ranked = rankHybridCandidates(rows, [], { limit: 10, now: NOW });

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
    const ranked = rankHybridCandidates(rows, [], { limit: 6, now: NOW });
    const bySource = Map.groupBy(ranked, (row) => row.sourceId);

    expect(ranked).toHaveLength(6);
    expect(bySource.get('source-1')).toHaveLength(3);
    expect(bySource.get('source-2')).toHaveLength(3);
  });

  it('expands immediate neighbors only after final ranking', () => {
    const [ranked] = rankHybridCandidates([candidate()], [], { limit: 1, now: NOW });
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
      {},
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
});
