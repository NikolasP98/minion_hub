import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { enqueueJob, getActiveJob, claimJob, requestCancel, isCancelRequested } from './finance-sync-jobs.service';

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
