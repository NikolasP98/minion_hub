import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { enqueueJob, claimJob, mergeCounts, pgErrorCode } from './meta-sync-jobs.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('enqueueJob', () => {
  it('inserts a queued job', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'job-new', orgId: 'org-1', kind: 'posts', status: 'queued' }]]); // insert().returning()
    const job = await enqueueJob(ctx(db), 'posts');
    expect(db.insert).toHaveBeenCalled();
    expect(job.status).toBe('queued');
  });

  it('recognizes a 23505 wrapped in a DrizzleQueryError-style cause chain', async () => {
    const wrapped = Object.assign(new Error('Failed query: insert ...'), {
      cause: Object.assign(new Error('duplicate key'), { code: '23505' }),
    });
    expect(pgErrorCode(wrapped)).toBe('23505');
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
  });

  it('returns the racing active job when insert throws a unique-violation (23505)', async () => {
    const raceJob = { id: 'job-race', orgId: 'org-1', kind: 'posts', status: 'running' };
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[raceJob]]); // getActiveJob select (in the catch path)
    const uniqueViolation = Object.assign(new Error('unique violation'), { code: '23505' });
    (db.insert as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw uniqueViolation;
    });
    const job = await enqueueJob(ctx(db), 'posts');
    expect(job.id).toBe('job-race');
  });
});

describe('claimJob', () => {
  it('returns true when the update claims a row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'job-1' }]);
    expect(await claimJob(ctx(db), 'job-1')).toBe(true);
  });
  it('returns false when no row was claimable', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    expect(await claimJob(ctx(db), 'job-1')).toBe(false);
  });
});

describe('mergeCounts', () => {
  it('sums keys present in both base and delta', () => {
    expect(mergeCounts({ postsProcessed: 10, metricsDenied: 1 }, { postsProcessed: 5, metricsDenied: 0 })).toEqual({
      postsProcessed: 15,
      metricsDenied: 1,
    });
  });
  it('adds new keys from delta and leaves untouched base keys alone', () => {
    expect(mergeCounts({ postsProcessed: 3 }, { igSkipped: 2 })).toEqual({ postsProcessed: 3, igSkipped: 2 });
  });
  it('treats an empty base as all-zero', () => {
    expect(mergeCounts({}, { messagesInserted: 4 })).toEqual({ messagesInserted: 4 });
  });
});
