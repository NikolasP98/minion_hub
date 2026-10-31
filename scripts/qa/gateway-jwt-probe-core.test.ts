import { describe, expect, it, vi } from 'vitest';
import {
  FOREIGN_AUDIENCE,
  UNASSIGNED_AGENT,
  classifyError,
  type ConnectOutcome,
  listAudiences,
  probeMatrix,
  runProbe,
  type ProbeDeps,
} from './gateway-jwt-probe-core';
import { gatewayAudience } from '../../src/server/services/gateway-jwt.service';

describe('listAudiences', () => {
  it('groups rows by the exact audience the hub mints, and reports unusable URLs', () => {
    const { groups, invalid } = listAudiences(
      [
        { id: 'faces', url: 'wss://Faces-Gateway.minion-ai.org', orgId: 'o1' },
        { id: 'panik', url: 'wss://netcup.example.ts.net:10000/', orgId: 'o2' },
        { id: 'base', url: 'wss://netcup.example.ts.net:10000', orgId: 'o3' },
        { id: 'broken', url: 'not a url', orgId: 'o4' },
      ],
      gatewayAudience,
    );
    expect(groups.map((g) => [g.audience, g.gateways.map((r) => r.id)])).toEqual([
      ['gw:faces-gateway.minion-ai.org', ['faces']],
      ['gw:netcup.example.ts.net:10000', ['panik', 'base']],
    ]);
    expect(invalid.map((i) => i.row.id)).toEqual(['broken']);
  });
});

/**
 * A fake gateway: closes 1008 `jwt_audience_not_allowed` on an unlisted audience,
 * refuses admin methods to members, and applies A1's label-only sessions.patch
 * rule against the JWT's agents.
 */
function fakeGateway(opts: {
  listed: string;
  role: 'admin' | 'user';
  agents?: string[];
  foreign?: ConnectOutcome | Error;
}) {
  const calls: string[] = [];
  const agents = opts.agents ?? ['main'];
  const deps: ProbeDeps = {
    mint: vi.fn(async (audience: string) => `jwt-for:${audience}`),
    agentIds: () => agents,
    connect: vi.fn(async (jwt: string) => {
      if (jwt !== `jwt-for:${opts.listed}`)
        throw new Error('closed (1008): jwt_audience_not_allowed');
      return {
        call: async (method: string, params: Record<string, unknown>) => {
          calls.push(method);
          if (method === 'config.schema' && opts.role !== 'admin')
            throw new Error('missing scope: operator.admin');
          if (method === 'sessions.patch' && opts.role !== 'admin') {
            const agent = String(params.key).split(':')[1];
            if (!agents.includes(agent)) throw new Error('missing scope: operator.admin');
          }
          return {};
        },
        close: vi.fn(),
      };
    }),
    connectOutcome: vi.fn(async () => {
      if (opts.foreign instanceof Error) throw opts.foreign;
      return opts.foreign ?? { admitted: false, code: 1008, reason: 'jwt_audience_not_allowed' };
    }),
  };
  return { deps, calls };
}

describe('runProbe', () => {
  it('passes for a member: read and write allowed, admin refused, foreign aud refused', async () => {
    const { deps, calls } = fakeGateway({ listed: 'gw:a', role: 'user' });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      'health',
      'status',
      'auth.refresh',
      'config.schema',
      'sessions.patch',
      'sessions.patch',
    ]);
    expect(deps.mint).toHaveBeenLastCalledWith(FOREIGN_AUDIENCE);
  });

  it('passes for a platform admin, whose admin call is allowed', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'admin' });
    expect((await runProbe({ audience: 'gw:a', isPlatformAdmin: true, deps })).ok).toBe(true);
  });

  it('fails when a member reaches an admin method', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'admin' });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines.find((l) => l.name.startsWith('admin'))).toMatchObject({
      expected: 'refused',
      actual: 'allowed',
    });
  });

  it('fails when a JWT for another audience is admitted (A1 not deployed)', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user', foreign: { admitted: true } });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatchObject({ expected: 'refused', actual: 'allowed' });
  });

  it.each([
    ['a timeout', new Error('connect timeout')],
    ['another close', { admitted: false, code: 1008, reason: 'device identity required' }],
    ['a non-1008 close', { admitted: false, code: 1006, reason: 'jwt_audience_not_allowed' }],
  ] as const)('fails the foreign-audience check on %s', async (_, foreign) => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user', foreign: foreign as never });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatchObject({ expected: 'refused', actual: 'error' });
  });

  it('fails when a member cannot label a session of their own agent (A1 OQ3)', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user', agents: ['main'] });
    deps.agentIds = () => ['other'];
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines.find((l) => l.name.includes('assigned agent'))).toMatchObject({
      expected: 'allowed',
      actual: 'refused',
    });
  });

  it('reports, without failing, a member with no assigned agent', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user', agents: [] });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(true);
    expect(result.lines.find((l) => l.actual === 'skipped')?.detail).toMatch(/no agent/);
  });

  it('labels only a dedicated probe session, and names an unassigned agent for the refusal', () => {
    const cases = probeMatrix(false, 'main').filter((c) => c.method === 'sessions.patch');
    expect(cases.map((c) => c.params(''))).toEqual([
      { key: 'agent:main:jwt-probe', label: 'jwt-probe' },
      { key: `agent:${UNASSIGNED_AGENT}:jwt-probe`, label: 'jwt-probe' },
    ]);
    expect(probeMatrix(true, 'main').some((c) => c.method === 'sessions.patch')).toBe(false);
  });

  it('fails when the gateway does not list this audience', async () => {
    const { deps } = fakeGateway({ listed: 'gw:other', role: 'user' });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatchObject({ name: 'JWT-only connect', actual: 'error' });
  });

  it('never puts a JWT in its report', async () => {
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user' });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(JSON.stringify(result)).not.toContain('jwt-for:');
  });

  it('treats an unrelated failure as an error, not a refusal', () => {
    expect(classifyError(new Error('missing scope: operator.admin'))).toBe('refused');
    expect(classifyError(new Error('gateway RPC timeout'))).toBe('error');
  });

  it('probes health, a read, a write and an admin method', () => {
    expect(
      probeMatrix(false)
        .slice(0, 4)
        .map((p) => [p.method, p.expect]),
    ).toEqual([
      ['health', 'allowed'],
      ['status', 'allowed'],
      ['auth.refresh', 'allowed'],
      ['config.schema', 'refused'],
    ]);
  });
});
