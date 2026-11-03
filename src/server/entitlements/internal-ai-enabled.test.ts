import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spec 043 T041: the gateway mirror and the flows runner learn `aiEnabled` per org from the hub.
const h = vi.hoisted(() => ({
  env: { HUB_API_TOKEN: 'hub-token' } as Record<string, string>,
  execute: vi.fn(),
  rows: [] as unknown[],
  flow: null as unknown,
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('@minion-stack/cache', async (orig) => ({
  ...(await orig<object>()),
  cached: async (_k: unknown, _o: unknown, loader: () => Promise<unknown>) => loader(),
}));
vi.mock('$lib/server/posthog', () => ({ captureServerEvent: vi.fn() }));
vi.mock('$server/services/gateway.pg.service', () => ({ resolveGatewayId: async () => 'gw-1' }));
vi.mock('$server/db/pg-client', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['select', 'from', 'where']) c[k] = () => c;
    c.limit = async () => result();
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
    return c;
  };
  return {
    getCoreDb: () => ({
      execute: h.execute,
      select: () => chain(() => (h.flow ? [h.flow] : h.rows)),
    }),
  };
});

import { GET as resolved } from '../../routes/api/internal/channels/resolved/+server';
import { GET as flowGet } from '../../routes/api/internal/flows/[id]/+server';

const wa = (accountId: string, tenantId: string | null) => ({
  type: 'whatsapp',
  accountId,
  tenantId,
  enabled: true,
  allowFrom: [],
  groupAllowFrom: [],
  requireMention: false,
  replies: 'all',
  settings: {},
  authRef: null,
  ownerProfileId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  delete h.env.ENTITLEMENTS_ENFORCED;
  h.flow = null;
  h.rows = [wa('a', 'base-org'), wa('b', 'premium-org'), wa('c', null)];
  h.execute.mockImplementation(async (q: { queryChunks?: unknown[] }) => {
    const org = JSON.stringify(q).includes('premium-org') ? 'premium' : null;
    return [{ kind: 'business', plan_key: org }];
  });
});

const channelsOf = async () => {
  const res = await resolved({
    locals: { tenantCtx: { tenantId: 'gw-org' }, serverId: 'srv' },
  } as never);
  const body = (await res.json()) as { channels: Array<{ accountId: string; aiEnabled: boolean }> };
  return body.channels.map((c) => [c.accountId, c.aiEnabled]);
};

describe('/api/internal/channels/resolved', () => {
  it('every account is aiEnabled when not enforced, with no lookup', async () => {
    expect(await channelsOf()).toEqual([
      ['a', true],
      ['b', true],
      ['c', true],
    ]);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("a Base org's accounts are false when enforced; a null tenant stays true", async () => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    expect(await channelsOf()).toEqual([
      ['a', false],
      ['b', true],
      ['c', true],
    ]);
    expect(h.execute).toHaveBeenCalledTimes(2); // once per distinct org
  });
  it('a lookup error never demotes: the last answer, else true, and logs lookup_error', async () => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    await channelsOf(); // base-org and premium-org answered once
    h.rows = [wa('a', 'base-org'), wa('b', 'premium-org'), wa('d', 'unseen-org')];
    h.execute.mockRejectedValue(new Error('db down'));
    expect(await channelsOf()).toEqual([
      ['a', false],
      ['b', true],
      ['d', true],
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      'entitlement.lookup_error',
      expect.stringContaining('unseen-org'),
    );
  });
});

describe('/api/internal/flows/[id]', () => {
  const get = async () => {
    const res = await flowGet({
      params: { id: 'f1' },
      request: new Request('http://hub.test', { headers: { Authorization: 'Bearer hub-token' } }),
    } as never);
    return (await res.json()) as { aiEnabled: boolean };
  };
  const flow = (tenantId: string | null) => ({ id: 'f1', tenantId, nodes: '[]', edges: '[]' });

  it('true when not enforced', async () => {
    h.flow = flow('base-org');
    expect((await get()).aiEnabled).toBe(true);
  });
  it('false for a Base org when enforced, true for Premium and for a null tenant', async () => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    h.flow = flow('base-org');
    expect((await get()).aiEnabled).toBe(false);
    h.flow = flow('premium-org');
    expect((await get()).aiEnabled).toBe(true);
    h.flow = flow(null);
    expect((await get()).aiEnabled).toBe(true);
  });
  it('a lookup error never demotes: the last answer, else true, and logs lookup_error', async () => {
    h.env.ENTITLEMENTS_ENFORCED = 'true';
    h.flow = flow('base-org');
    expect((await get()).aiEnabled).toBe(false); // base-org answered once
    h.execute.mockRejectedValue(new Error('db down'));
    expect((await get()).aiEnabled).toBe(false);
    h.flow = flow('flow-unseen-org');
    expect((await get()).aiEnabled).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      'entitlement.lookup_error',
      expect.stringContaining('flow-unseen-org'),
    );
  });
});
