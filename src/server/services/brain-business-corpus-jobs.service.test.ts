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
const { JobEffectError } = await import('./job-effects.service');
const { JobEffectPageError } = await import('./job-effect-pages.service');
const { CorpusPageBusy } = await import('./brain-corpus.service');

const execution = {
  jobId: 'job-1',
  tenantId: 'org-1',
  leaseGeneration: 1,
  signal: new AbortController().signal,
  effectKey: () => 'effect',
  withOwnership: vi.fn(),
};
const owned = expect.objectContaining({ execution });
const advance = (job: unknown) => advanceBusinessCorpusJob(job as never, execution as never);

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
    const result = await advance({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: 0,
        domainCursor: null,
        processed: 0,
        changedChunks: 0,
        embeddedChunks: 0,
      }),
    });
    expect(backfillBusinessKnowledgeDomain).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'stock',
      { cursor: null, limit: 50 },
      owned,
    );
    const next = {
      domainIndex: 0,
      domainCursor: 'next-page',
      processed: 50,
      changedChunks: 12,
      embeddedChunks: 12,
      failedDomains: 0,
      attempts: 0,
    };
    expect(result).toEqual({ done: false, cursor: next });
    // The service commits exactly this cursor with the page's effects.
    expect(
      backfillBusinessKnowledgeDomain.mock.calls[0][3].progress({
        domain: 'stock',
        processed: 50,
        changedChunks: 12,
        embeddedChunks: 12,
        hasMore: true,
        nextCursor: 'next-page',
      }),
    ).toEqual(next);
  });

  it('moves to the next domain after a final page', async () => {
    backfillBusinessKnowledgeDomain.mockResolvedValue({
      processed: 3,
      changedChunks: 0,
      embeddedChunks: 0,
      hasMore: false,
      nextCursor: null,
    });
    const result = await advance({ tenantId: 'org-1', cursor: null });
    expect(result).toMatchObject({ done: false, cursor: { domainIndex: 1, domainCursor: null } });
    expect(businessDomainAt(1)).toBe('crm');
  });

  it('records a poison domain and advances instead of restarting from domain zero', async () => {
    const failure = new Error('invalid source row');
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(failure);
    const result = await advance({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: 1,
        domainCursor: 'poison-page',
        processed: 75,
        changedChunks: 8,
        embeddedChunks: 7,
        failedDomains: 0,
      }),
    });

    const next = {
      domainIndex: 2,
      domainCursor: null,
      processed: 75,
      changedChunks: 8,
      embeddedChunks: 7,
      failedDomains: 1,
      attempts: 0,
    };
    // The domain failure and the exact next cursor commit together under ownership.
    expect(recordBusinessKnowledgeDomainError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'crm',
      failure,
      { execution, nextProgress: next },
    );
    expect(result).toEqual({ done: false, cursor: next });
  });

  it.each([
    ['lost ownership', new JobEffectError('ownership_lost', 'Job ownership was lost')],
    ['an indeterminate provider outcome', new JobEffectError('indeterminate', 'no response')],
    ['a missing reservation owner', new JobEffectPageError('owner_missing', 'recovery required')],
  ])('rethrows %s without domain failure accounting or a status write', async (_name, cause) => {
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(cause);
    await expect(
      advance({ tenantId: 'org-1', cursor: JSON.stringify({ domainIndex: 1, failedDomains: 0 }) }),
    ).rejects.toMatchObject({
      code: cause.code,
      message: `brain_corpus_business ${cause.code}: ${cause.message}`,
    });
    expect(recordBusinessKnowledgeDomainError).not.toHaveBeenCalled();
  });

  it('re-prepares a superseded page a bounded number of times before isolating the domain', async () => {
    const superseded = new JobEffectPageError('superseded', 'Business record changed');
    backfillBusinessKnowledgeDomain.mockRejectedValue(superseded);
    await expect(
      advance({ tenantId: 'org-1', cursor: JSON.stringify({ domainIndex: 1, failedDomains: 0 }) }),
    ).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({ domainIndex: 1, attempts: 1, failedDomains: 0 }),
    });
    expect(recordBusinessKnowledgeDomainError).not.toHaveBeenCalled();
    await expect(
      advance({
        tenantId: 'org-1',
        cursor: JSON.stringify({ domainIndex: 1, failedDomains: 0, attempts: 2 }),
      }),
    ).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({ domainIndex: 2, attempts: 0, failedDomains: 1 }),
    });
    expect(recordBusinessKnowledgeDomainError).toHaveBeenCalledOnce();
  });

  it('yields the unchanged cursor while another job holds the page reservation', async () => {
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(new CorpusPageBusy('owner_busy'));
    await expect(
      advance({ tenantId: 'org-1', cursor: JSON.stringify({ domainIndex: 1, failedDomains: 0 }) }),
    ).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({ domainIndex: 1, attempts: 0, failedDomains: 0 }),
    });
    expect(recordBusinessKnowledgeDomainError).not.toHaveBeenCalled();
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

    const result = await advance({
      tenantId: 'org-1',
      cursor: JSON.stringify({
        domainIndex: finalDomainIndex,
        domainCursor: null,
        processed: 75,
        changedChunks: 8,
        embeddedChunks: 7,
        failedDomains: 2,
      }),
    });

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
      advance({
        tenantId: 'org-1',
        cursor: JSON.stringify({ domainIndex: finalDomainIndex, failedDomains: 0 }),
      }),
    ).resolves.toEqual({ done: true });
  });

  it('finishes failed when the final domain itself is isolated', async () => {
    const failure = new Error('final domain failed');
    backfillBusinessKnowledgeDomain.mockRejectedValueOnce(failure);
    let finalDomainIndex = 0;
    while (businessDomainAt(finalDomainIndex + 1)) finalDomainIndex += 1;

    const result = await advance({
      tenantId: 'org-1',
      cursor: JSON.stringify({ domainIndex: finalDomainIndex, failedDomains: 0 }),
    });

    expect(result).toEqual({
      done: true,
      error: 'Business corpus reconciliation completed with 1 failed domain',
    });
    expect(recordBusinessKnowledgeDomainError).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      businessDomainAt(finalDomainIndex),
      failure,
      expect.objectContaining({ execution }),
    );
  });
});
