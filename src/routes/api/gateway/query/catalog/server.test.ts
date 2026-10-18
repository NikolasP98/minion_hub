import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), moduleEnabled: vi.fn() }));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: mocks.moduleEnabled }));
vi.mock('../../_shared/action-auth', () => ({ requireAssistantCapability: mocks.auth }));
vi.mock('$server/services/pos/catalog-query', () => ({ queryCatalogPrices: mocks.query }));
import { GET } from './+server';
import { ASSISTANT_TOOL_DECLARATIONS } from '$server/services/assistant-tool-catalog';
const revision = ASSISTANT_TOOL_DECLARATIONS[0].contractRevision;
const ctx = { tenantId: 'org-a', profileId: 'profile-a' };
const call = (query: string) =>
  GET({
    locals: {},
    url: new URL(`https://hub.test/api/gateway/query/catalog?agentId=personal-a&${query}`),
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.auth.mockResolvedValue({ ctx });
  mocks.query.mockResolvedValue({ items: [] });
});
describe('catalog query authority and contract admission', () => {
  it('rechecks pos.view and uses authorized context plus schema defaults', async () => {
    const response = await call(`contractRevision=${revision}`);
    expect(mocks.auth).toHaveBeenCalledWith({}, expect.any(URL), 'pos', 'view');
    expect(mocks.query).toHaveBeenCalledWith(ctx, 'product', 5);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each(['', 'contractRevision=old'])(
    'rejects absent/stale schema before business data: %s',
    async (query) => {
      const response = await call(query);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'TOOL_CONTRACT_CHANGED',
        retryable: false,
      });
      expect(mocks.query).not.toHaveBeenCalled();
    },
  );
  it('rejects a retired declaration even when its old revision matches', async () => {
    const tool = ASSISTANT_TOOL_DECLARATIONS[0];
    tool.lifecycle = 'retired';
    try {
      expect((await call(`contractRevision=${revision}`)).status).toBe(409);
      expect(mocks.query).not.toHaveBeenCalled();
    } finally {
      tool.lifecycle = 'active';
    }
  });
  it('rechecks module availability at execution after discovery', async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const response = await call(`contractRevision=${revision}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'TOOL_MODULE_DISABLED', retryable: false });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('does not read data after a principal or capability denial', async () => {
    mocks.auth.mockRejectedValue({ status: 403 });
    await expect(call(`contractRevision=${revision}`)).rejects.toMatchObject({ status: 403 });
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([
    'limit=0',
    'limit=21',
    'limit=2.5',
    'limit=',
    'limit=NaN',
    'kind=unknown',
    'kind=product&kind=all',
    'endpoint=/secrets',
    'orgId=org-a&orgId=org-b',
  ])('rejects invalid inputs before querying: %s', async (query) => {
    const response = await call(`contractRevision=${revision}&${query}`);
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('accepts explicit valid kind and limit', async () => {
    expect((await call(`contractRevision=${revision}&kind=all&limit=20`)).status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(ctx, 'all', 20);
  });
});
