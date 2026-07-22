import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { loadEnv } from 'vite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedBusinessDocument } from './brain-business-corpus.service';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (
    _ctx: unknown,
    callback: (tx: { execute: typeof mocks.execute }) => Promise<unknown>,
  ) => callback({ execute: mocks.execute }),
}));

const { persistBusinessDocuments } = await import('./brain-business-corpus.service');

const SOURCE_ID = '00000000-0000-4000-8000-000000000001';
const CHUNK_KEY = 'record:000000';
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

function preparedDocument(
  index: number,
  options?: { changedChunk?: boolean; staleChunkKeys?: string[] },
): PreparedBusinessDocument {
  const suffix = index.toString(16).padStart(12, '0');
  const occurredAt = new Date('2026-07-22T00:00:00.000Z');
  const changedChunk = options?.changedChunk ?? true;
  return {
    sourceId: SOURCE_ID,
    documentId: `00000000-0000-4000-8000-${suffix}`,
    changedDocument: true,
    changedChunkKeys: new Set(changedChunk ? [CHUNK_KEY] : []),
    staleChunkKeys: options?.staleChunkKeys ?? [],
    document: {
      externalId: `record:${index}`,
      title: `Record ${index}`,
      rawText: '{}',
      normalizedText: `Record ${index}`,
      contentHash: `document-hash-${index}`,
      sourceRevision: `revision-${index}`,
      occurredAt,
      sourceUpdatedAt: occurredAt,
      metadata: { domain: 'crm', recordType: 'test' },
      chunks: changedChunk
        ? [
            {
              chunkKey: CHUNK_KEY,
              kind: 'raw',
              seq: 0,
              chunkText: `Chunk ${index}`,
              contextPrefix: 'CRM; test',
              contentHash: `chunk-hash-${index}`,
              occurredAt,
              metadata: { domain: 'crm' },
            },
          ]
        : [],
    },
  };
}

function queryText(callIndex: number): string {
  const query = mocks.execute.mock.calls[callIndex]?.[0];
  return new PgDialect().sqlToQuery(query).sql;
}

function queryParams(callIndex: number): unknown[] {
  const query = mocks.execute.mock.calls[callIndex]?.[0];
  return new PgDialect().sqlToQuery(query).params;
}

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue([]);
});

describe('business corpus set-based persistence', () => {
  it('bounds a 205-record page to document and chunk batches', async () => {
    const prepared = Array.from({ length: 205 }, (_, index) => preparedDocument(index));
    const vectors = new Map(
      prepared.map((item) => [`${item.documentId}\u0000${CHUNK_KEY}`, [0.1, 0.2]]),
    );

    await expect(
      persistBusinessDocuments({ tenantId: 'org-1' } as never, prepared, vectors),
    ).resolves.toBe(0);

    // 3 document batches (100/100/5) + 26 chunk batches (25×8 + 5).
    expect(mocks.execute).toHaveBeenCalledTimes(29);
    expect(queryText(0)).toMatch(/insert into knowledge_documents[\s\S]*on conflict/);
    expect(queryText(3)).toMatch(/insert into knowledge_chunks[\s\S]*on conflict/);
    expect(queryText(3)).toContain('coalesce(excluded.embedding, knowledge_chunks.embedding)');
    expect(queryParams(0)).toHaveLength(1_200);
    expect(queryParams(1)).toHaveLength(1_200);
    expect(queryParams(2)).toHaveLength(60);
    expect(queryParams(2)).toContain('document-hash-204');
    expect(queryParams(3)).toHaveLength(96);
    expect(queryParams(28)).toHaveLength(60);
  });

  it('batches stale chunk deletion and returns the deleted count', async () => {
    const staleChunkKeys = Array.from({ length: 501 }, (_, index) => `stale:${index}`);
    const prepared = [preparedDocument(1, { changedChunk: false, staleChunkKeys })];
    mocks.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'deleted-1' }])
      .mockResolvedValueOnce([{ id: 'deleted-2' }]);

    await expect(
      persistBusinessDocuments({ tenantId: 'org-1' } as never, prepared, new Map()),
    ).resolves.toBe(2);

    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(queryText(1)).toMatch(
      /delete from knowledge_chunks[\s\S]*current_setting\('app.current_org_id'/,
    );
    expect(queryText(2)).toContain('using (values');
  });

  it('marks a changed document pending when its changed chunk has no vector', async () => {
    await persistBusinessDocuments(
      { tenantId: 'org-1' } as never,
      [preparedDocument(1)],
      new Map(),
    );

    const documentQuery = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(documentQuery.params).toContain('pending');
    expect(queryText(1)).toContain('null');
  });

  it('skips fully unchanged items and deduplicates a repeated source identity', async () => {
    const unchanged = preparedDocument(1, { changedChunk: false });
    unchanged.changedDocument = false;
    await persistBusinessDocuments({ tenantId: 'org-1' } as never, [unchanged], new Map());
    expect(mocks.execute).not.toHaveBeenCalled();

    const first = preparedDocument(2);
    const last = preparedDocument(3);
    last.document.externalId = first.document.externalId;
    await persistBusinessDocuments(
      { tenantId: 'org-1' } as never,
      [first, last],
      new Map([[`${last.documentId}\u0000${CHUNK_KEY}`, [0.1, 0.2]]]),
    );

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(queryParams(0)).toContain('document-hash-3');
    expect(queryParams(0)).not.toContain('document-hash-2');
  });
});

describe.runIf(Boolean(databaseUrl))('business corpus persistence SQL against PostgreSQL', () => {
  it('EXPLAINs document, chunk, and stale-delete batches against the live schema', async () => {
    const prepared = [preparedDocument(11, { staleChunkKeys: ['stale:11'] }), preparedDocument(12)];
    const vectors = new Map(
      prepared.map((item) => [
        `${item.documentId}\u0000${CHUNK_KEY}`,
        Array.from({ length: 1_536 }, () => 0.1),
      ]),
    );
    await persistBusinessDocuments({ tenantId: 'org-1' } as never, prepared, vectors);

    const client = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    try {
      expect(mocks.execute).toHaveBeenCalledTimes(3);
      for (const [query] of mocks.execute.mock.calls) {
        const rendered = new PgDialect().sqlToQuery(query);
        await client.unsafe(`explain ${rendered.sql}`, rendered.params as never[]);
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  }, 120_000);
});
