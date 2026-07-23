import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureWhatsAppReconcileJob = vi.fn();
const advanceBrainCorpusJobNow = vi.fn();
const ensureBusinessReconcileJob = vi.fn();
const advanceBusinessCorpusJobNow = vi.fn();
const execute = vi.fn();

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ execute }) }));
vi.mock('$server/services/brain-corpus-jobs.service', () => ({
  ensureWhatsAppReconcileJob,
  advanceBrainCorpusJobNow,
}));
vi.mock('$server/services/brain-business-corpus-jobs.service', () => ({
  ensureBusinessReconcileJob,
  advanceBusinessCorpusJobNow,
}));

const { GET } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  execute.mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }]);
  ensureWhatsAppReconcileJob
    .mockResolvedValueOnce({ jobId: 'job-1', created: true })
    .mockResolvedValueOnce({ jobId: 'job-2', created: false });
  advanceBrainCorpusJobNow.mockResolvedValue(undefined);
  ensureBusinessReconcileJob
    .mockResolvedValueOnce({ jobId: 'business-1', created: false })
    .mockResolvedValueOnce({ jobId: 'business-2', created: true });
  advanceBusinessCorpusJobNow.mockResolvedValue(undefined);
});

describe('GET /api/brains/reconcile/tick', () => {
  it('rejects requests without the cron Bearer secret', async () => {
    await expect(
      GET!({ request: new Request('http://localhost/api/brains/reconcile/tick') } as never),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('ensures and advances one durable reconcile job per org', async () => {
    const response = (await GET!({
      request: new Request('http://localhost/api/brains/reconcile/tick', {
        headers: { authorization: 'Bearer sekret' },
      }),
    } as never)) as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      orgs: 2,
      created: 1,
      resumed: 1,
      advanced: 2,
      businessCreated: 1,
      businessResumed: 1,
      businessAdvanced: 2,
      errors: 0,
    });
    expect(ensureWhatsAppReconcileJob).toHaveBeenCalledTimes(2);
    expect(advanceBrainCorpusJobNow).toHaveBeenNthCalledWith(1, 'job-1');
    expect(advanceBrainCorpusJobNow).toHaveBeenNthCalledWith(2, 'job-2');
    expect(ensureBusinessReconcileJob).toHaveBeenCalledTimes(2);
    expect(advanceBusinessCorpusJobNow).toHaveBeenNthCalledWith(1, 'business-1');
    expect(advanceBusinessCorpusJobNow).toHaveBeenNthCalledWith(2, 'business-2');
  });
});
