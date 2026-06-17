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
