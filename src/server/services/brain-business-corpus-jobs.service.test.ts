import { beforeEach, describe, expect, it, vi } from 'vitest';

const backfillBusinessKnowledgeDomain = vi.fn();
const ensureBusinessKnowledgeSources = vi.fn();
const recordBusinessKnowledgeDomainError = vi.fn();
const getCoreDb = vi.fn(() => ({ marker: 'db' }));
const registerJobHandler = vi.fn();
const advanceJob = vi.fn();

vi.mock('$server/db/pg-client', () => ({ getCoreDb }));
vi.mock('./brain-business-corpus.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('./brain-business-corpus.service')>();
  return {
    ...original,
    backfillBusinessKnowledgeDomain,
    ensureBusinessKnowledgeSources,
    recordBusinessKnowledgeDomainError,
  };
});
vi.mock('./bg-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./bg-runtime')>();
  return { ...original, registerJobHandler, advanceJob };
});

const { advanceBusinessCorpusJob, businessDomainAt } =
  await import('./brain-business-corpus-jobs.service');

beforeEach(() => vi.clearAllMocks());

describe('business corpus job cursor', () => {
  it('advances a bounded page and persists the domain cursor', async () => {
    backfillBusinessKnowledgeDomain.mockResolvedValue({
      processed: 50,
      changedChunks: 12,
      embeddedChunks: 12,
      hasMore: true,
      nextCursor: 'next-page',
    });
    const result = await advanceBusinessCorpusJob({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: 0,
        domainCursor: null,
        processed: 0,
        changedChunks: 0,
        embeddedChunks: 0,
      }),
    } as never);
    expect(backfillBusinessKnowledgeDomain).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'stock',
      { cursor: null, limit: 50 },
    );
    expect(result).toEqual({
      done: false,
      cursor: {
        domainIndex: 0,
        domainCursor: 'next-page',
        processed: 50,
        changedChunks: 12,
        embeddedChunks: 12,
        failedDomains: 0,
      },
    });
  });

  it('moves to the next domain after a final page', async () => {
    backfillBusinessKnowledgeDomain.mockResolvedValue({
      processed: 3,
      changedChunks: 0,
      embeddedChunks: 0,
      hasMore: false,
      nextCursor: null,
    });
    const result = await advanceBusinessCorpusJob({ tenantId: 'org-1', cursor: null } as never);
    expect(result).toMatchObject({ done: false, cursor: { domainIndex: 1, domainCursor: null } });
    expect(businessDomainAt(1)).toBe('crm');
  });

  it('records a poison domain and advances instead of restarting from domain zero', async () => {
    const failure = new Error('invalid source row');
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(failure);
    const result = await advanceBusinessCorpusJob({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: 1,
        domainCursor: 'poison-page',
        processed: 75,
        changedChunks: 8,
        embeddedChunks: 7,
        failedDomains: 0,
      }),
    } as never);

    expect(recordBusinessKnowledgeDomainError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'crm',
      failure,
    );
    expect(result).toEqual({
      done: false,
      cursor: {
        domainIndex: 2,
        domainCursor: null,
        processed: 75,
        changedChunks: 8,
        embeddedChunks: 7,
        failedDomains: 1,
      },
    });
  });

  it('finishes failed when an earlier isolated domain failed', async () => {
    backfillBusinessKnowledgeDomain.mockResolvedValue({
      processed: 3,
      changedChunks: 0,
      embeddedChunks: 0,
      hasMore: false,
      nextCursor: null,
    });
    let finalDomainIndex = 0;
    while (businessDomainAt(finalDomainIndex + 1)) finalDomainIndex += 1;

    const result = await advanceBusinessCorpusJob({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: finalDomainIndex,
        domainCursor: null,
        processed: 75,
        changedChunks: 8,
        embeddedChunks: 7,
        failedDomains: 2,
      }),
    } as never);

    expect(result).toEqual({
      done: true,
      error: 'Business corpus reconciliation completed with 2 failed domains',
    });
  });

  it('finishes cleanly when every domain completed without an isolated failure', async () => {
    backfillBusinessKnowledgeDomain.mockResolvedValue({
      processed: 0,
      changedChunks: 0,
      embeddedChunks: 0,
      hasMore: false,
      nextCursor: null,
    });
    let finalDomainIndex = 0;
    while (businessDomainAt(finalDomainIndex + 1)) finalDomainIndex += 1;

    await expect(
      advanceBusinessCorpusJob({
        tenantId: 'org-1',
        cursor: JSON.stringify({ domainIndex: finalDomainIndex, failedDomains: 0 }),
      } as never),
    ).resolves.toEqual({ done: true });
  });

  it('finishes failed when the final domain itself is isolated', async () => {
    const failure = new Error('final domain failed');
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(failure);
    let finalDomainIndex = 0;
    while (businessDomainAt(finalDomainIndex + 1)) finalDomainIndex += 1;

    const result = await advanceBusinessCorpusJob({
      tenantId: 'org-1',
      cursor: JSON.stringify({ domainIndex: finalDomainIndex, failedDomains: 0 }),
    } as never);

    expect(result).toEqual({
      done: true,
      error: 'Business corpus reconciliation completed with 1 failed domain',
    });
    expect(recordBusinessKnowledgeDomainError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      businessDomainAt(finalDomainIndex),
      failure,
    );
  });
});
