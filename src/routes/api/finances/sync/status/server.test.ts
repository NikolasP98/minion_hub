import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ctx: vi.fn(), byId: vi.fn(), active: vi.fn(), latest: vi.fn() }));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: mocks.ctx }));
vi.mock('$server/services/finance-sync-jobs.service', () => ({
  getJobById: mocks.byId,
  getActiveJob: mocks.active,
  getLatestJob: mocks.latest,
}));
import { GET } from './+server';
const id = 'f7871b9d-8462-4942-8419-b575cb592e9c';
const event = (query = '') =>
  ({ locals: {}, url: new URL(`http://localhost/api/finances/sync/status${query}`) }) as never;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ctx.mockResolvedValue({ tenantId: 'org-a' });
});
describe('finance sync exact job status', () => {
  it('passes authenticated org scope to exact lookup and never falls back to latest', async () => {
    mocks.byId.mockResolvedValue({ id, status: 'succeeded', total: 2, processed: 2 });
    const response = await GET(event(`?jobId=${id}`));
    expect(mocks.byId).toHaveBeenCalledWith({ tenantId: 'org-a' }, id);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.latest).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ jobId: id, active: false, status: 'succeeded' });
  });
  it('does not substitute another job when an exact ID is inaccessible', async () => {
    mocks.byId.mockResolvedValue(null);
    const response = await GET(event(`?jobId=${id}`));
    expect(await response.json()).toMatchObject({ jobId: null, active: false, status: null });
    expect(mocks.latest).not.toHaveBeenCalled();
  });
  it('retains provider discovery and includes its durable identity', async () => {
    mocks.active.mockResolvedValue({ id, status: 'running' });
    const response = await GET(event('?provider=susii'));
    expect(mocks.active).toHaveBeenCalledWith({ tenantId: 'org-a' }, 'susii');
    expect(await response.json()).toMatchObject({ jobId: id, active: true });
  });
  it('rejects malformed IDs before querying', async () => {
    await expect(GET(event('?jobId=nope'))).rejects.toMatchObject({ status: 400 });
    expect(mocks.byId).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    mocks.ctx.mockResolvedValue(null);
    await expect(GET(event(`?jobId=${id}`))).rejects.toMatchObject({ status: 401 });
    expect(mocks.byId).not.toHaveBeenCalled();
  });
});
