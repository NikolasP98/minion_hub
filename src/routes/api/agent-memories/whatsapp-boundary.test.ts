import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  search: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  embed: vi.fn(),
}));
vi.mock('$server/auth/assistant-principal', () => ({ resolveAssistantPrincipal: mocks.principal }));
vi.mock('$server/services/agent-memories.service', () => ({
  searchMemories: mocks.search,
  upsertMemories: mocks.upsert,
  deleteMemoriesBySource: mocks.remove,
}));
vi.mock('$server/services/embeddings', () => ({
  embeddingsEnabled: () => true,
  embedText: mocks.embed,
  embedTexts: vi.fn().mockResolvedValue([[1, 2]]),
}));
import { POST as recall } from './recall/+server';
import { POST as ingest } from './ingest/+server';
import { POST as remove } from './delete/+server';
function event(body: unknown) {
  return {
    locals: {
      serverId: 'gateway',
      tenantCtx: { tenantId: 'org' },
      whatsappAdmissionId: 'admission',
    },
    request: new Request('https://hub.test', { method: 'POST', body: JSON.stringify(body) }),
  } as unknown as Parameters<typeof recall>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.principal.mockImplementation(async (_locals, url: URL) => {
    if (url.searchParams.get('agentId') !== 'personal-alice') throw { status: 403 };
    return { principalId: 'alice', orgId: 'org' };
  });
  mocks.embed.mockResolvedValue([1, 2]);
  mocks.search.mockResolvedValue([{ content: 'private memory' }]);
});
describe('internal memory authority', () => {
  it('blocks a forged agent before embedding, retrieval, write or deletion', async () => {
    await expect(recall(event({ agentId: 'personal-bob', query: 'secret' }))).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(
      ingest(event({ rows: [{ agentId: 'personal-bob', content: 'overwrite' }] })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      remove(event({ agentId: 'personal-bob', source: 'kg', sourceId: '1' })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.embed).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('blocks an ingest forged profile or gateway', async () => {
    for (const extra of [{ profileId: 'bob' }, { gatewayId: 'other-gateway' }]) {
      await expect(
        ingest(event({ rows: [{ agentId: 'personal-alice', content: 'data', ...extra }] })),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it('rechecks admission after embedding before accessing storage', async () => {
    mocks.principal
      .mockResolvedValueOnce({ principalId: 'alice', orgId: 'org' })
      .mockRejectedValueOnce({ status: 403 });
    await expect(
      recall(event({ agentId: 'personal-alice', query: 'remember' })),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.embed).toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it('retains the canonical agent namespace and org scope', async () => {
    const response = await recall(event({ agentId: 'personal-alice', query: 'remember' }));
    expect(await response.json()).toEqual({ hits: [{ content: 'private memory' }] });
    expect(mocks.search).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ agentId: 'personal-alice' }),
    );
    expect(mocks.principal).toHaveBeenCalledTimes(3);
  });
});
