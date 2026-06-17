import { describe, it, expect, vi, beforeEach } from 'vitest';

const findResumableJobs = vi.fn();
const advanceJob = vi.fn<() => Promise<void>>(async () => {});
vi.mock('$server/services/finance-sync-jobs.service', () => ({ findResumableJobs: (...a: unknown[]) => findResumableJobs() }));
vi.mock('$server/services/finance-sync.service', () => ({ advanceJob: (...a: unknown[]) => advanceJob() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));

import { GET } from './+server';

function req(auth?: string) {
  return { request: new Request('http://x/api/finances/sync/tick', auth ? { headers: { authorization: auth } } : undefined) } as never;
}
beforeEach(() => { vi.clearAllMocks(); findResumableJobs.mockResolvedValue([{ jobId: 'j1', orgId: 'o1', provider: 'susii' }]); });

describe('GET /api/finances/sync/tick', () => {
  it('rejects without the cron secret', async () => {
    await expect(GET(req())).rejects.toMatchObject({ status: 401 });
    expect(advanceJob).not.toHaveBeenCalled();
  });
  it('advances resumable jobs when authorized', async () => {
    const res = await GET(req('Bearer sekret'));
    expect(await res.json()).toEqual({ advanced: 1 });
    expect(advanceJob).toHaveBeenCalledTimes(1);
  });
});
