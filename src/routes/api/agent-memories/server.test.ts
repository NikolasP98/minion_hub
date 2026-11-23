import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsertMemories = vi.fn();
const deleteMemoriesBySource = vi.fn();
const searchMemories = vi.fn();
const requireFeature = vi.fn();

vi.mock('$server/services/agent-memories.service', () => ({
  upsertMemories,
  deleteMemoriesBySource,
  searchMemories,
}));
vi.mock('$server/services/embeddings', () => ({
  embedText: vi.fn().mockResolvedValue([0.1]),
  embedTexts: vi.fn().mockResolvedValue([[0.1]]),
  embeddingsEnabled: () => true,
}));
vi.mock('$server/services/entitlements.service', () => ({ requireFeature }));

const ingest = (await import('./ingest/+server')).POST!;
const del = (await import('./delete/+server')).POST!;
const recall = (await import('./recall/+server')).POST!;

const body = {
  rows: [{ agentId: 'a', content: 'x', source: 's', sourceId: '1' }],
  agentId: 'a',
  source: 's',
  sourceId: '1',
  query: 'q',
};
const call = (h: typeof ingest, locals: Record<string, unknown>) =>
  h({
    locals,
    request: new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
  } as never);

const sessionOnly = { tenantCtx: { tenantId: 'org-1' } };
const token = { tenantCtx: { tenantId: 'org-1' }, serverId: 'gw-1' };

beforeEach(() => {
  vi.clearAllMocks();
  upsertMemories.mockResolvedValue(1);
  deleteMemoriesBySource.mockResolvedValue(2);
  searchMemories.mockResolvedValue([]);
  requireFeature.mockResolvedValue(undefined);
});

describe('agent-memories gateway-only routes', () => {
  it.each([
    ['ingest', ingest, upsertMemories],
    ['delete', del, deleteMemoriesBySource],
    ['recall', recall, searchMemories],
  ])('%s: session-only locals get 401 and the service is not called', async (_n, h, svc) => {
    await expect(call(h, sessionOnly)).rejects.toMatchObject({ status: 401 });
    expect(svc).not.toHaveBeenCalled();
  });

  it('ingest and delete work with a gateway token', async () => {
    expect(((await call(ingest, token)) as Response).status).toBe(200);
    expect(upsertMemories).toHaveBeenCalled();
    expect(await ((await call(del, token)) as Response).json()).toEqual({ ok: true, deleted: 2 });
    expect(deleteMemoriesBySource).toHaveBeenCalledWith('org-1', {
      agentId: 'a',
      source: 's',
      sourceId: '1',
    });
  });

  it('recall works with a gateway token', async () => {
    expect(((await call(recall, token)) as Response).status).toBe(200);
    expect(searchMemories).toHaveBeenCalled();
  });
});
