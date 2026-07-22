import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueJob = vi.fn();
const registerJobHandler = vi.fn();
const syncWhatsAppConversation = vi.fn();
const backfillWhatsAppConversations = vi.fn();
const markWhatsAppSourceFailure = vi.fn();

vi.mock('./bg-runtime', () => ({
  enqueueJob,
  registerJobHandler,
  advanceJob: vi.fn(),
}));
vi.mock('./brain-corpus.service', () => ({
  syncWhatsAppConversation,
  backfillWhatsAppConversations,
  markWhatsAppSourceFailure,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: vi.fn(() => ({})) }));

const { advanceBrainCorpusJob, collectDirtyWhatsAppConversations, enqueueWhatsAppBrainChanges } =
  await import('./brain-corpus-jobs.service');

const job = (cursor: unknown) => ({
  id: 'job-1',
  tenantId: 'org-1',
  userId: null,
  type: 'brain_corpus_whatsapp',
  refId: 'whatsapp:dirty',
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
  syncWhatsAppConversation.mockResolvedValue({ processed: 1 });
  markWhatsAppSourceFailure.mockResolvedValue(undefined);
});

describe('WhatsApp brain dirty jobs', () => {
  it('selects only safely identifiable 1:1 human WhatsApp rows and deduplicates conversations', () => {
    const rows = [
      {
        channel: 'whatsapp',
        accountId: ' a1 ',
        chatId: ' c1 ',
        isGroup: false,
        isBot: false,
        content: 'one',
      },
      {
        channel: 'whatsapp',
        accountId: 'a1',
        chatId: 'c1',
        isGroup: null,
        isBot: null,
        content: 'two',
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
        content: 'skip',
      },
    ];
    expect(collectDirtyWhatsAppConversations(rows)).toEqual([{ accountId: 'a1', chatId: 'c1' }]);
  });

  it('enqueues one durable batch job for distinct conversations', async () => {
    await enqueueWhatsAppBrainChanges('org-1', [
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
        type: 'brain_corpus_whatsapp',
        cursor: expect.objectContaining({ kind: 'dirty', next: 0 }),
      }),
    );
  });

  it('advances one conversation and persists the next index', async () => {
    const result = await advanceBrainCorpusJob(
      job({
        kind: 'dirty',
        conversations: [
          { accountId: 'a1', chatId: 'c1' },
          { accountId: 'a1', chatId: 'c2' },
        ],
        next: 0,
      }) as never,
    );
    expect(syncWhatsAppConversation).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'a1',
      'c1',
    );
    expect(result).toEqual(
      expect.objectContaining({ done: false, cursor: expect.objectContaining({ next: 1 }) }),
    );
  });

  it('surfaces handler failures on the source before failing the durable job', async () => {
    syncWhatsAppConversation.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      advanceBrainCorpusJob(
        job({
          kind: 'dirty',
          conversations: [{ accountId: 'a1', chatId: 'c1' }],
          next: 0,
        }) as never,
      ),
    ).rejects.toThrow('provider down');
    expect(markWhatsAppSourceFailure).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      'a1',
      expect.any(Error),
    );
  });
});

describe('WhatsApp brain reconcile jobs', () => {
  it('persists the service cursor instead of restarting at the first page', async () => {
    backfillWhatsAppConversations.mockResolvedValueOnce({
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
    );
    expect(backfillWhatsAppConversations).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'org-1' }),
      { cursor: 'current-page', limit: 25 },
    );
    expect(result).toEqual({
      done: false,
      cursor: {
        kind: 'reconcile',
        cursor: 'next-page',
        processed: 50,
        changedChunks: 5,
        embeddedChunks: 5,
      },
    });
  });
});
