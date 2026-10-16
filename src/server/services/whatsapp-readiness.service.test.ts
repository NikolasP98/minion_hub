import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransactionSql } from 'postgres';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), active: vi.fn(), pg: vi.fn() }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCallToInstance: mocks.rpc }));
vi.mock('./whatsapp-member-authority', () => ({ assertWhatsAppUserActive: mocks.active }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: mocks.pg }));
import {
  inspectWhatsAppMember,
  validateWhatsAppReadiness,
  readinessCustomTools,
  getWhatsAppAccountReadiness,
  requireWhatsAppAccountReady,
} from './whatsapp-readiness.service';
const binding = {
  agentId: 'personal-user',
  profileId: 'user',
  orgId: 'org',
  gatewayId: 'gateway',
  channelId: 'channel',
};
function report(overrides = {}) {
  return {
    version: 1,
    agentId: binding.agentId,
    profileId: binding.profileId,
    orgId: binding.orgId,
    channelId: binding.channelId,
    checkedAt: Date.now(),
    configHash: 'a'.repeat(64),
    ready: true,
    canonicalMemory: true,
    capabilityParity: true,
    blockers: [],
    capabilities: { hub: ['remember'], whatsapp: ['remember'] },
    ...overrides,
  };
}
function fixtureTx(
  overrides: {
    assignment?: unknown[];
    custom?: unknown[];
    rules?: unknown[];
    queries?: string[];
  } = {},
) {
  return vi.fn((parts: TemplateStringsArray | unknown[]) => {
    if (!('raw' in parts)) return parts;
    const sql = parts.join(' ');
    overrides.queries?.push(sql);
    if (sql.includes('from personal_agents'))
      return Promise.resolve(
        overrides.assignment ?? [
          {
            agent_id: binding.agentId,
            gateway_id: binding.gatewayId,
            provisioning_status: 'active',
            role: 'member',
            url: 'ws://localhost',
            token_ciphertext: 'synthetic',
            token_iv: '',
          },
        ],
      );
    if (sql.includes('from user_identities')) return Promise.resolve([{ id: 'claim' }]);
    if (sql.includes('from channels')) return Promise.resolve([{ id: binding.channelId }]);
    if (sql.includes('from member_roles')) return Promise.resolve([{ role_key: 'staff' }]);
    if (sql.includes('from permission_rules')) return Promise.resolve(overrides.rules ?? []);
    if (sql.includes('from built_tools')) return Promise.resolve(overrides.custom ?? []);
    throw Error(sql);
  }) as unknown as TransactionSql;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue(undefined);
  mocks.rpc.mockResolvedValue(report());
});
describe('fresh WhatsApp runtime readiness', () => {
  it('accepts the exact current complete report only', () => {
    expect(validateWhatsAppReadiness(report(), binding).ready).toBe(true);
    const invalid = [
      { agentId: 'other' },
      { profileId: 'other' },
      { orgId: 'other' },
      { channelId: 'other' },
      { channelId: undefined },
      { checkedAt: Date.now() - 31_000 },
      { checkedAt: Date.now() + 6_000 },
      { configHash: 'forged' },
      { canonicalMemory: false },
      { capabilityParity: false },
      { blockers: [{ code: 'blocked', message: 'reason' }] },
      { capabilities: { hub: ['remember', 'exec'], whatsapp: ['remember'] } },
      { capabilities: { hub: ['remember', 'remember'], whatsapp: ['remember', 'remember'] } },
    ];
    for (const patch of invalid)
      expect(validateWhatsAppReadiness(report(patch), binding).ready).toBe(false);
  });
  it('queries canonical assignment and fresh RBAC, sends no custom source or credentials in payload', async () => {
    const result = await inspectWhatsAppMember(
      fixtureTx({
        custom: [
          {
            name: 'Team lookup',
            execution_config: '{"permission":{"module":"crm","action":"view"},"script":"secret"}',
          },
        ],
      }),
      binding,
    );
    expect(result.ready).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'ws://localhost',
      'synthetic',
      'agents.whatsapp.readiness',
      expect.objectContaining({
        agentId: binding.agentId,
        profileId: binding.profileId,
        orgId: binding.orgId,
        channelId: binding.channelId,
        customTools: [
          { name: 'custom_team_lookup', permission: { module: 'crm', action: 'view' } },
        ],
        permissions: { modules: expect.any(Object) },
      }),
      { timeoutMs: 5000 },
    );
    const payload = mocks.rpc.mock.calls[0][3];
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(payload.permissions.modules.settings).toBeUndefined();
  });
  it('rejects a stale or inactive assignment and revoked GoTrue user before gateway RPC', async () => {
    for (const assignment of [
      [],
      [{ agent_id: binding.agentId, gateway_id: 'wrong', provisioning_status: 'active' }],
      [
        {
          agent_id: binding.agentId,
          gateway_id: binding.gatewayId,
          provisioning_status: 'pending',
        },
      ],
    ]) {
      expect((await inspectWhatsAppMember(fixtureTx({ assignment }), binding)).ready).toBe(false);
    }
    mocks.active.mockRejectedValue(Error('revoked'));
    expect((await inspectWhatsAppMember(fixtureTx(), binding)).ready).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports unavailable/partial RPC and default unqualified policy without changing provisioning', async () => {
    const queries: string[] = [];
    const tx = fixtureTx({ queries });
    mocks.rpc.mockRejectedValueOnce(Error('offline'));
    expect((await inspectWhatsAppMember(tx, binding)).blockers[0].code).toBe(
      'gateway_readiness_unavailable',
    );
    mocks.rpc.mockResolvedValueOnce(
      report({
        ready: false,
        capabilityParity: false,
        blockers: [
          { code: 'sandbox_unqualified', message: 'Default agent lacks required isolation' },
        ],
      }),
    );
    expect((await inspectWhatsAppMember(tx, binding)).ready).toBe(false);
    expect(
      queries.every(
        (query) =>
          !/update|insert|delete/.test(
            query.replaceAll('can_delete', 'can_remove').replaceAll('updated_at', 'changed_at'),
          ),
      ),
    ).toBe(true);
  });
  it('rejects ambiguous published tool inventory before trusting a gateway ready report', async () => {
    const result = await inspectWhatsAppMember(
      fixtureTx({
        custom: [
          { name: 'A b', execution_config: '{}' },
          { name: 'A-b', execution_config: '{}' },
        ],
      }),
      binding,
    );
    expect(result.blockers[0].code).toBe('custom_inventory_unverified');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not invent ambiguous custom-tool collision identities', () => {
    expect(
      readinessCustomTools([
        { name: 'A b', execution_config: '{}' },
        { name: 'A-b', execution_config: '{}' },
      ]),
    ).toBeUndefined();
    expect(
      readinessCustomTools([
        {
          name: 'Unknown action',
          execution_config: '{"permission":{"module":"crm","action":"invented"}}',
        },
      ]),
    ).toEqual([{ name: 'custom_unknown_action' }]);
    expect(readinessCustomTools([{ name: 'Á', execution_config: 'invalid' }])).toEqual([
      { name: 'custom_tool' },
    ]);
  });
});

describe('account readiness pagination and activation', () => {
  const ids = Array.from(
    { length: 6 },
    (_, i) => `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  );
  function accountFixture(candidates: string[]) {
    const memberTx = fixtureTx();
    const tx = vi.fn((parts: TemplateStringsArray | unknown[], ...values: unknown[]) => {
      if ('raw' in parts && parts.join(' ').includes('select distinct m.profile_id')) {
        const cursor = values[1] as string | null;
        const limit = values[values.length - 1] as number;
        return Promise.resolve(
          candidates
            .filter((id) => !cursor || id > cursor)
            .slice(0, limit)
            .map((profile_id) => ({ profile_id })),
        );
      }
      return (memberTx as unknown as (...args: unknown[]) => unknown)(parts, ...values);
    });
    mocks.pg.mockReturnValue({ begin: (callback: (sql: unknown) => unknown) => callback(tx) });
    mocks.rpc.mockImplementation(async (_url, _token, _method, params) =>
      report({
        agentId: params.agentId,
        profileId: params.profileId,
        orgId: params.orgId,
        channelId: params.channelId,
        ready: params.profileId === ids[4],
        capabilityParity: params.profileId === ids[4],
        blockers:
          params.profileId === ids[4]
            ? []
            : [{ code: 'isolation_required', message: 'Needs isolation' }],
      }),
    );
  }
  it('accepts a healthy member after blocked members without requiring every agent ready', async () => {
    accountFixture(ids);
    await expect(
      requireWhatsAppAccountReady({ orgId: 'org', gatewayId: 'gateway' }),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledTimes(6);
  });
  it('reports an empty eligible account without calling a gateway', async () => {
    accountFixture([]);
    await expect(
      requireWhatsAppAccountReady({ orgId: 'org', gatewayId: 'gateway' }),
    ).rejects.toMatchObject({ status: 409, body: { readiness: { complete: true, inspected: 0 } } });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('paginates status and never calls an incomplete page globally unqualified', async () => {
    accountFixture(ids);
    const first = await getWhatsAppAccountReadiness(
      { orgId: 'org', gatewayId: 'gateway' },
      { limit: 4 },
    );
    expect(first).toMatchObject({
      ready: false,
      complete: false,
      nextCursor: ids[3],
      blockers: [{ code: 'readiness_incomplete' }],
    });
    expect(first.members).toHaveLength(4);
    const second = await getWhatsAppAccountReadiness(
      { orgId: 'org', gatewayId: 'gateway' },
      { limit: 4, cursor: first.nextCursor! },
    );
    expect(second).toMatchObject({ ready: true, complete: true, nextCursor: null });
  });
  it('bounds activation work and reports incomplete when no ready member fits the deadline', async () => {
    accountFixture(ids);
    let now = 100_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.rpc.mockImplementation(async (_url, _token, _method, params) => {
      now += 4_000;
      return report({
        agentId: params.agentId,
        profileId: params.profileId,
        orgId: params.orgId,
        channelId: params.channelId,
        ready: false,
        capabilityParity: false,
        blockers: [{ code: 'not_ready', message: 'Blocked' }],
      });
    });
    try {
      await expect(
        requireWhatsAppAccountReady({ orgId: 'org', gatewayId: 'gateway' }),
      ).rejects.toMatchObject({
        status: 409,
        body: { readiness: { complete: false, inspected: 4 } },
      });
      expect(mocks.rpc.mock.calls.length).toBeLessThanOrEqual(4);
    } finally {
      clock.mockRestore();
    }
  });
});
