import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { enqueueJob, getActiveJob, claimJob, requestCancel, isCancelRequested, isJobStale, STALE_MS } from './finance-sync-jobs.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('enqueueJob', () => {
  it('returns the existing active job (dedupe) without inserting', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'job-active', orgId: 'org-1', provider: 'susii', status: 'running' }]]); // getActiveJob select
    const job = await enqueueJob(ctx(db), 'susii');
    expect(job.id).toBe('job-active');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts a queued job when none is active', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [],                                                            // getActiveJob → none
      [{ id: 'job-new', orgId: 'org-1', provider: 'susii', status: 'queued' }], // insert().returning()
    ]);
    const job = await enqueueJob(ctx(db), 'susii');
    expect(db.insert).toHaveBeenCalled();
    expect(job.status).toBe('queued');
  });

  it('returns the racing active job when insert throws a unique-violation (23505)', async () => {
    // Simulate: getActiveJob → none (check), insert → unique-violation, getActiveJob → now exists
    const raceJob = { id: 'job-race', orgId: 'org-1', provider: 'susii', status: 'running' };
    const { db, resolveSequence } = createMockDb();
    // Sequence: [] for the initial getActiveJob select, [raceJob] for the catch-path getActiveJob select
    resolveSequence([[], [raceJob]]);
    const uniqueViolation = Object.assign(new Error('unique violation'), { code: '23505' });
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => { throw uniqueViolation; });
    const job = await enqueueJob(ctx(db), 'susii');
    expect(job.id).toBe('job-race');
  });
});

describe('claimJob', () => {
  it('returns true when the update claims a row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'job-1' }]); // update().returning() → one row
    expect(await claimJob(ctx(db), 'job-1')).toBe(true);
  });
  it('returns false when no row was claimable', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // update().returning() → none
    expect(await claimJob(ctx(db), 'job-1')).toBe(false);
  });
});

describe('cancel', () => {
  it('requestCancel issues an update', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await requestCancel(ctx(db), 'susii');
    expect(db.update).toHaveBeenCalled();
  });
  it('isCancelRequested reads the flag', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ cancelRequested: true }]);
    expect(await isCancelRequested(ctx(db), 'job-1')).toBe(true);
  });
});

describe('isJobStale', () => {
  const NOW = Date.UTC(2026, 7, 13, 7, 30, 0);
  const at = (msAgo: number) => new Date(NOW - msAgo);

  it('treats a running job with a fresh heartbeat as alive', () => {
    expect(isJobStale({ status: 'running', heartbeatAt: at(60_000) }, NOW)).toBe(false);
  });

  it('treats a running job past STALE_MS as dead — the frozen-worker case', () => {
    // Aug 2026: worker died 2m into a run, row stayed `running` forever and the
    // UI disabled the Sync button that would have resumed it.
    expect(isJobStale({ status: 'running', heartbeatAt: at(STALE_MS + 1) }, NOW)).toBe(true);
  });

  it('treats a running job with no heartbeat as dead', () => {
    expect(isJobStale({ status: 'running', heartbeatAt: null }, NOW)).toBe(true);
  });

  it('never calls a terminal job stale, however old', () => {
    for (const status of ['succeeded', 'failed', 'cancelled', 'queued'] as const) {
      expect(isJobStale({ status, heartbeatAt: at(864_000_000) }, NOW)).toBe(false);
    }
  });
});
