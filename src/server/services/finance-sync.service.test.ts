import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the collaborating services so advanceJob's control flow is isolated.
const claimJob = vi.fn<() => Promise<boolean>>();
const getJobById = vi.fn();
const heartbeat = vi.fn<(c: unknown, id: string, patch: { processed: number; total?: number | null; pageCursor: string | null }) => Promise<void>>(async () => {});
const isCancelRequested = vi.fn<() => Promise<boolean>>(async () => false);
const finishJob = vi.fn<(c: unknown, id: string, status: string, o?: unknown) => Promise<void>>(async () => {});
vi.mock('./finance-sync-jobs.service', () => ({
  STALE_MS: 90_000,
  claimJob: (...a: unknown[]) => claimJob(),
  getJobById: (...a: unknown[]) => getJobById(),
  heartbeat: (c: unknown, id: string, patch: { processed: number; total?: number | null; pageCursor: string | null }) => heartbeat(c, id, patch),
  isCancelRequested: (...a: unknown[]) => isCancelRequested(),
  finishJob: (c: unknown, id: string, status: string, o?: unknown) => finishJob(c, id, status, o),
  enqueueJob: vi.fn(),
}));

const getSource = vi.fn();
const setSourceSync = vi.fn<() => Promise<void>>(async () => {});
const upsertInvoicesBatch = vi.fn<() => Promise<void>>(async () => {});
const loadProductMap = vi.fn(async () => new Map());
const bustFinanceCache = vi.fn(async () => {});
vi.mock('./finance.service', () => ({
  getSource: (...a: unknown[]) => getSource(),
  setSourceSync: (...a: unknown[]) => setSourceSync(),
  upsertInvoicesBatch: (...a: unknown[]) => upsertInvoicesBatch(),
  loadProductMap: (...a: unknown[]) => loadProductMap(),
  bustFinanceCache: (...a: unknown[]) => bustFinanceCache(),
}));

vi.mock('./finance-secrets', () => ({ decryptCreds: () => ({ username: 'u', password: 'p' }) }));

// A fake connector registered for provider 'fake'.
const pages: Array<{ invoices: unknown[]; cursor: string | null }> = [];
/** Captures the args advanceJob computes, so `since` can be asserted. */
const pullArgs: Array<{ since?: string; cursor?: string | null }> = [];
vi.mock('$server/finance/connector', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getConnector: () => ({
      provider: 'fake',
      async *pullPages(a: { since?: string; cursor?: string | null }) {
        pullArgs.push({ since: a?.since, cursor: a?.cursor ?? null });
        for (const p of pages) yield p;
      },
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
  pullArgs.length = 0;
  claimJob.mockResolvedValue(true);
  isCancelRequested.mockResolvedValue(false);
  getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: null, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
});

describe('advanceJob', () => {
  it('drains all pages then marks succeeded and advances the watermark', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    pages.push({ invoices: [{}, {}], cursor: 'c1' }, { invoices: [{}], cursor: null });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoicesBatch).toHaveBeenCalledTimes(2);
    expect(setSourceSync).toHaveBeenCalled();
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'succeeded', undefined);
  });

  it('does nothing when the job cannot be claimed', async () => {
    claimJob.mockResolvedValue(false);
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoicesBatch).not.toHaveBeenCalled();
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
    expect(upsertInvoicesBatch).not.toHaveBeenCalled();
  });

  it('budget-exhaustion: persists cursor after first page and does not call finishJob', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    pages.push({ invoices: [{}], cursor: 'c1' }, { invoices: [{}], cursor: 'c2' });
    // budgetMs: -1 → deadline = Date.now() - 1, guaranteed in the past so the deadline check fires after page 1
    await advanceJob(ctx, 'j1', { budgetMs: -1 });
    // The per-page heartbeat after page 1 must carry pageCursor:'c1'
    expect(heartbeat).toHaveBeenCalledWith(expect.anything(), 'j1', expect.objectContaining({ pageCursor: 'c1' }));
    // Job left in 'running' state — finishJob must NOT have been called
    expect(finishJob).not.toHaveBeenCalled();
    // Only the first page's batch was upserted (budget expired before page 2)
    expect(upsertInvoicesBatch).toHaveBeenCalledTimes(1);
  });

  it('batch upsert failure: calls finishJob with status failed', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    upsertInvoicesBatch.mockRejectedValueOnce(new Error('boom'));
    pages.push({ invoices: [{}, {}, {}, {}, {}], cursor: 'c1' });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(finishJob).toHaveBeenCalledWith(
      expect.anything(), 'j1', 'failed',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});

// ── nightly window is a HARD ceiling ───────────────────────────────────────
// The daily cron must never drag in more than its window, however stale the
// watermark is; that is the whole point of calling it "bounded".
describe('advanceJob — recentWindowMs clamps the nightly sync', () => {
  const DAY = 86_400_000;
  const WEEK = 7 * DAY;

  it('clamps to the window when the watermark is OLDER than it', async () => {
    const stale = new Date(Date.now() - 60 * DAY).toISOString(); // 60 days behind
    getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: stale, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date().toISOString() });
    pages.push({ invoices: [], cursor: null });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await advanceJob(ctx, 'j1', { budgetMs: Infinity, recentWindowMs: WEEK });

    const since = Date.parse(pullArgs[0].since!);
    // ~7 days back, NOT 60.
    expect(Date.now() - since).toBeLessThan(WEEK + DAY);
    expect(Date.now() - since).toBeGreaterThan(WEEK - DAY);
    // The skipped range must be reported, never silently swallowed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clamping to'));
    warn.mockRestore();
  });

  it('uses the watermark when it is NEWER than the window — the cheap path', async () => {
    const fresh = new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(); // 9h
    getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: fresh, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
    getJobById.mockResolvedValue({ id: 'j2', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date().toISOString() });
    pages.push({ invoices: [], cursor: null });

    await advanceJob(ctx, 'j2', { budgetMs: Infinity, recentWindowMs: WEEK });

    const since = Date.parse(pullArgs[0].since!);
    expect(Date.now() - since).toBeLessThan(DAY); // hours, not a week
  });

  it('leaves the MANUAL path (no window) sweeping from the watermark', async () => {
    const stale = new Date(Date.now() - 60 * DAY).toISOString();
    getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: stale, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
    getJobById.mockResolvedValue({ id: 'j3', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date().toISOString() });
    pages.push({ invoices: [], cursor: null });

    await advanceJob(ctx, 'j3', { budgetMs: Infinity });

    expect(Date.now() - Date.parse(pullArgs[0].since!)).toBeGreaterThan(59 * DAY);
  });
});
