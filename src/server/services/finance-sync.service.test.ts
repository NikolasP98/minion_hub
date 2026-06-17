import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the collaborating services so advanceJob's control flow is isolated.
const claimJob = vi.fn<() => Promise<boolean>>();
const getJobById = vi.fn();
const heartbeat = vi.fn<() => Promise<void>>(async () => {});
const isCancelRequested = vi.fn<() => Promise<boolean>>(async () => false);
const finishJob = vi.fn<(c: unknown, id: string, status: string, o?: unknown) => Promise<void>>(async () => {});
vi.mock('./finance-sync-jobs.service', () => ({
  STALE_MS: 90_000,
  claimJob: (...a: unknown[]) => claimJob(),
  getJobById: (...a: unknown[]) => getJobById(),
  heartbeat: (...a: unknown[]) => heartbeat(),
  isCancelRequested: (...a: unknown[]) => isCancelRequested(),
  finishJob: (c: unknown, id: string, status: string, o?: unknown) => finishJob(c, id, status, o),
  enqueueJob: vi.fn(),
}));

const getSource = vi.fn();
const setSourceSync = vi.fn<() => Promise<void>>(async () => {});
const upsertInvoice = vi.fn<() => Promise<void>>(async () => {});
vi.mock('./finance.service', () => ({
  getSource: (...a: unknown[]) => getSource(),
  setSourceSync: (...a: unknown[]) => setSourceSync(),
  upsertInvoice: (...a: unknown[]) => upsertInvoice(),
}));

vi.mock('./finance-secrets', () => ({ decryptCreds: () => ({ username: 'u', password: 'p' }) }));

// A fake connector registered for provider 'fake'.
const pages: Array<{ invoices: unknown[]; cursor: string | null }> = [];
vi.mock('$server/finance/connector', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getConnector: () => ({
      provider: 'fake',
      async *pullPages() { for (const p of pages) yield p; },
      async *pull() {},
      async count() { return 5; },
    }),
  };
});

import { advanceJob } from './finance-sync.service';

const ctx = { db: {} as never, tenantId: 'org-1' };
beforeEach(() => {
  vi.clearAllMocks();
  pages.length = 0;
  claimJob.mockResolvedValue(true);
  getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: null, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
});

describe('advanceJob', () => {
  it('drains all pages then marks succeeded and advances the watermark', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    pages.push({ invoices: [{}, {}], cursor: 'c1' }, { invoices: [{}], cursor: null });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoice).toHaveBeenCalledTimes(3);
    expect(setSourceSync).toHaveBeenCalled();
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'succeeded', undefined);
  });

  it('does nothing when the job cannot be claimed', async () => {
    claimJob.mockResolvedValue(false);
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoice).not.toHaveBeenCalled();
    expect(finishJob).not.toHaveBeenCalled();
  });

  it('marks failed with "no credentials configured" when secretRefs is empty', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: null, config: {}, secretRefs: {} });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'failed', { error: 'no credentials configured' });
  });

  it('cancels mid-stream when cancel is requested', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    isCancelRequested.mockResolvedValue(true);
    pages.push({ invoices: [{}], cursor: 'c1' });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'cancelled', undefined);
    expect(upsertInvoice).not.toHaveBeenCalled();
  });
});
