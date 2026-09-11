import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueJob = vi.fn();
const registerJobHandler = vi.fn();
const syncConversation = vi.fn();
const backfillConversations = vi.fn();
const markConversationSourceFailure = vi.fn();
const selectLimit = vi.fn();
const updateReturning = vi.fn();
const db = {
  select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) })),
  update: vi.fn(() => ({
    set: () => ({ where: () => ({ returning: updateReturning }) }),
  })),
};

vi.mock('./bg-runtime', () => ({
  enqueueJob,
  registerJobHandler,
  advanceJob: vi.fn(),
}));
vi.mock('./brain-corpus.service', async (importOriginal) => {
  const original = await importOriginal<typeof import('./brain-corpus.service')>();
  return {
    ...original,
    syncConversation,
    backfillConversations,
    markConversationSourceFailure,
  };
});
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn(() => db) }));
const { JobEffectError } = await import('./job-effects.service');
const { JobEffectPageError } = await import('./job-effect-pages.service');
const { CorpusPageBusy } = await import('./brain-corpus.service');

const {
  advanceBrainCorpusJob,
  collectDirtyConversations,
  enqueueConversationBrainChanges,
  mergeDirtyConversations,
} = await import('./brain-corpus-jobs.service');

const execution = {
  jobId: 'job-1',
  tenantId: 'org-1',
  leaseGeneration: 1,
  signal: new AbortController().signal,
  effectKey: () => 'effect',
  withOwnership: vi.fn(),
};
const owned = expect.objectContaining({ execution });

const job = (cursor: unknown) => ({
  id: 'job-1',
  tenantId: 'org-1',
  userId: null,
  type: 'brain_corpus_conversations',
  refId: 'conversations:dirty',
  status: 'running',
  cursor: JSON.stringify(cursor),
  error: null,
  attempts: 0,
  leaseUntil: null,
  createdAt: 1,
  updatedAt: 1,
  startedAt: 1,
  finishedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  enqueueJob.mockResolvedValue('job-1');
  selectLimit.mockResolvedValue([]);
  updateReturning.mockResolvedValue([]);
  syncConversation.mockResolvedValue({ processed: 1 });
  markConversationSourceFailure.mockResolvedValue(undefined);
});

describe('all-channel conversation brain dirty jobs', () => {
  it('selects safely identifiable 1:1 human rows across channels and deduplicates conversations', () => {
    const rows = [
      {
        channel: 'whatsapp',
        accountId: ' a1 ',
        chatId: ' c1 ',
        isGroup: false,
        isBot: false,
        content: 'one',
        occurredAt: Date.parse('2026-07-10T00:00:00Z'),
      },
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'c1',
        isGroup: null,
        isBot: null,
        content: 'two',
        occurredAt: Date.parse('2026-08-10T00:00:00Z'),
      },
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'group',
        isGroup: true,
        isBot: false,
        content: 'skip',
      },
      {
        channel: 'telegram',
        accountId: 'a1',
        chatId: 'c2',
        isGroup: false,
        isBot: false,
        content: 'include',
      },
    ];
    expect(collectDirtyConversations(rows)).toEqual([
      { channel: 'telegram', accountId: 'a1', chatId: 'c2', months: [] },
      { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07', '2026-08'] },
    ]);
  });

  it('skips a malformed channel without dropping valid rows in the same batch', () => {
    const rows = [
      {
        channel: undefined as never,
        accountId: 'a1',
        chatId: 'bad',
        isGroup: false,
        isBot: false,
        content: 'skip',
      },
      {
        channel: 'telegram',
        accountId: 'a1',
        chatId: 'good',
        isGroup: false,
        isBot: false,
        content: 'keep',
      },
    ];

    expect(collectDirtyConversations(rows)).toEqual([
      { channel: 'telegram', accountId: 'a1', chatId: 'good', months: [] },
    ]);
  });

  it('enqueues one durable batch job for distinct conversations', async () => {
    await enqueueConversationBrainChanges('org-1', [
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'c1',
        isGroup: false,
        isBot: false,
        content: 'one',
      },
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'c2',
        isGroup: false,
        isBot: false,
        content: 'two',
      },
    ]);
    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'org-1',
        type: 'brain_corpus_conversations',
        cursor: expect.objectContaining({ kind: 'dirty', next: 0, failures: [] }),
      }),
    );
  });

  it('coalesces into an existing queued dirty job instead of creating another job', async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: 'queued-1',
        cursor: JSON.stringify({
          kind: 'dirty',
          conversations: [
            { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
          ],
          next: 0,
        }),
      },
    ]);
    updateReturning.mockResolvedValueOnce([{ id: 'queued-1' }]);
    await expect(
      enqueueConversationBrainChanges('org-1', [
        {
          channel: 'whatsapp',
          accountId: 'a1',
          chatId: 'c1',
          isGroup: false,
          isBot: false,
          content: 'August',
          occurredAt: Date.parse('2026-08-01T00:00:00Z'),
        },
      ]),
    ).resolves.toBe('queued-1');
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledOnce();
  });

  it('enqueues a fresh repair when a concurrent writer wins the queued-job CAS', async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: 'queued-1',
        cursor: JSON.stringify({
          kind: 'dirty',
          conversations: [
            { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
          ],
          next: 0,
          failures: [],
        }),
      },
    ]);
    updateReturning.mockResolvedValueOnce([]);
    await expect(
      enqueueConversationBrainChanges('org-1', [
        {
          channel: 'whatsapp',
          accountId: 'a1',
          chatId: 'c2',
          isGroup: false,
          isBot: false,
          content: 'new work',
        },
      ]),
    ).resolves.toBe('job-1');
    expect(enqueueJob).toHaveBeenCalledOnce();
  });

  it('advances one conversation and persists the next index', async () => {
    const result = await advanceBrainCorpusJob(
      job({
        kind: 'dirty',
        conversations: [
          { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
          { channel: 'instagram', accountId: 'a1', chatId: 'c2', months: ['2026-08'] },
        ],
        next: 0,
      }) as never,
      execution as never,
    );
    expect(syncConversation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'whatsapp',
      'a1',
      'c1',
      { months: ['2026-07'] },
      owned,
    );
    // The committed progress and the returned cursor are the same durable value.
    const committed = syncConversation.mock.calls[0][5].progress({});
    expect(result).toEqual({ done: false, cursor: committed });
    expect(committed).toEqual(expect.objectContaining({ next: 1, attempts: 0 }));
  });

  it('drains queued legacy WhatsApp jobs after the all-channel handler deploys', async () => {
    const legacy = {
      ...job({
        kind: 'dirty',
        conversations: [{ accountId: 'a1', chatId: 'c1', months: ['2026-07'] }],
        next: 0,
        failures: [],
      }),
      type: 'brain_corpus_whatsapp',
      refId: 'whatsapp:dirty',
    };

    await expect(advanceBrainCorpusJob(legacy as never, execution as never)).resolves.toEqual({
      done: true,
    });
    expect(syncConversation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'whatsapp',
      'a1',
      'c1',
      { months: ['2026-07'] },
      owned,
    );
  });

  it('isolates a poison conversation and marks only its account source', async () => {
    syncConversation.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      advanceBrainCorpusJob(
        job({
          kind: 'dirty',
          conversations: [
            { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
          ],
          next: 0,
        }) as never,
        execution as never,
      ),
    ).resolves.toEqual({
      done: true,
      error: 'whatsapp/a1/c1: provider down',
    });
    // Failure state and the exact next cursor are committed together under ownership.
    expect(markConversationSourceFailure).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'whatsapp',
      'a1',
      expect.any(Error),
      {
        execution,
        nextProgress: expect.objectContaining({
          kind: 'dirty',
          next: 1,
          failures: ['whatsapp/a1/c1: provider down'],
        }),
      },
    );
  });

  const dirtyJob = () =>
    job({
      kind: 'dirty',
      conversations: [
        { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
        { channel: 'whatsapp', accountId: 'a1', chatId: 'c2', months: [] },
      ],
      next: 0,
      failures: [],
    }) as never;

  it.each([
    ['lost ownership', new JobEffectError('ownership_lost', 'Job ownership was lost')],
    ['an indeterminate provider outcome', new JobEffectError('indeterminate', 'no response')],
    ['a missing reservation owner', new JobEffectPageError('owner_missing', 'recovery required')],
  ])('rethrows %s without failure accounting, source status or progress', async (_name, cause) => {
    syncConversation.mockRejectedValueOnce(cause);
    await expect(advanceBrainCorpusJob(dirtyJob(), execution as never)).rejects.toMatchObject({
      code: cause.code,
      message: `brain_corpus ${cause.code}: ${cause.message}`,
    });
    expect(markConversationSourceFailure).not.toHaveBeenCalled();
  });

  it('re-prepares a superseded conversation a bounded number of times, then isolates it', async () => {
    const superseded = new JobEffectPageError('superseded', 'Conversation source changed');
    syncConversation.mockRejectedValue(superseded);
    await expect(advanceBrainCorpusJob(dirtyJob(), execution as never)).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({ next: 0, attempts: 1, failures: [] }),
    });
    expect(markConversationSourceFailure).not.toHaveBeenCalled();
    const exhausted = { ...(dirtyJob() as { cursor: string }) };
    exhausted.cursor = JSON.stringify({ ...JSON.parse(exhausted.cursor), attempts: 2 });
    await expect(advanceBrainCorpusJob(exhausted as never, execution as never)).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({
        next: 1,
        attempts: 0,
        failures: ['whatsapp/a1/c1: Conversation source changed'],
      }),
    });
    expect(markConversationSourceFailure).toHaveBeenCalledOnce();
  });

  it('yields the unchanged cursor while another job holds the page reservation', async () => {
    syncConversation.mockRejectedValueOnce(new CorpusPageBusy('owner_busy'));
    await expect(advanceBrainCorpusJob(dirtyJob(), execution as never)).resolves.toEqual({
      done: false,
      cursor: expect.objectContaining({ next: 0, attempts: 0 }),
    });
    expect(markConversationSourceFailure).not.toHaveBeenCalled();
  });

  it('rethrows lost ownership from the failure write itself', async () => {
    syncConversation.mockRejectedValueOnce(new Error('provider down'));
    const lost = new JobEffectError('ownership_lost', 'Job ownership was lost');
    markConversationSourceFailure.mockRejectedValueOnce(lost);
    await expect(advanceBrainCorpusJob(dirtyJob(), execution as never)).rejects.toMatchObject({
      code: 'ownership_lost',
    });
  });

  it('coalesces account/chat/month work and lets an unknown month dominate', () => {
    expect(
      mergeDirtyConversations([
        { channel: 'whatsapp', accountId: 'a1', chatId: 'c1', months: ['2026-07'] },
        {
          channel: 'whatsapp',
          accountId: 'a1',
          chatId: 'c1',
          months: ['2026-08', '2026-07'],
        },
        { channel: 'whatsapp', accountId: 'a1', chatId: 'c2', months: [] },
        { channel: 'whatsapp', accountId: 'a1', chatId: 'c2', months: ['2026-09'] },
        { channel: 'instagram', accountId: 'a1', chatId: 'c2', months: ['2026-09'] },
      ]),
    ).toEqual([
      { channel: 'instagram', accountId: 'a1', chatId: 'c2', months: ['2026-09'] },
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'c1',
        months: ['2026-07', '2026-08'],
      },
      { channel: 'whatsapp', accountId: 'a1', chatId: 'c2', months: [] },
    ]);
  });
});

describe('all-channel conversation brain reconcile jobs', () => {
  it('persists the service cursor instead of restarting at the first page', async () => {
    backfillConversations.mockResolvedValueOnce({
      processed: 25,
      changedChunks: 3,
      embeddedChunks: 3,
      nextCursor: 'next-page',
      hasMore: true,
    });
    const result = await advanceBrainCorpusJob(
      job({
        kind: 'reconcile',
        cursor: 'current-page',
        processed: 25,
        changedChunks: 2,
        embeddedChunks: 2,
      }) as never,
      execution as never,
    );
    expect(backfillConversations).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      { cursor: 'current-page', limit: 25 },
      owned,
    );
    const next = {
      kind: 'reconcile',
      cursor: 'next-page',
      processed: 50,
      changedChunks: 5,
      embeddedChunks: 5,
      attempts: 0,
    };
    expect(result).toEqual({ done: false, cursor: next });
    // The service commits exactly this cursor with the page's effects.
    expect(
      backfillConversations.mock.calls[0][2].progress({
        processed: 25,
        changedChunks: 3,
        embeddedChunks: 3,
        nextCursor: 'next-page',
        hasMore: true,
      }),
    ).toEqual(next);
  });

  it('rethrows lost ownership without marking every conversation source failed', async () => {
    const lost = new JobEffectError('ownership_lost', 'Job ownership was lost');
    backfillConversations.mockRejectedValueOnce(lost);
    await expect(
      advanceBrainCorpusJob(
        job({ kind: 'reconcile', cursor: null, processed: 0 }) as never,
        execution as never,
      ),
    ).rejects.toMatchObject({
      code: 'ownership_lost',
      message: expect.stringContaining('ownership_lost'),
    });
    expect(markConversationSourceFailure).not.toHaveBeenCalled();
  });

  it('marks sources failed under ownership and rethrows an ordinary reconcile error', async () => {
    const cause = new Error('ledger unavailable');
    backfillConversations.mockRejectedValueOnce(cause);
    await expect(
      advanceBrainCorpusJob(
        job({ kind: 'reconcile', cursor: null, processed: 0 }) as never,
        execution as never,
      ),
    ).rejects.toBe(cause);
    expect(markConversationSourceFailure).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      null,
      null,
      cause,
      { execution },
    );
  });
});
