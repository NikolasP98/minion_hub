import { describe, expect, it, vi } from 'vitest';
import {
  FOREIGN_AUDIENCE,
  classifyError,
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

/** A fake gateway: refuses unlisted audiences at connect, and admin methods to members. */
function fakeGateway(opts: { listed: string; role: 'admin' | 'user'; leakForeign?: boolean }) {
  const calls: string[] = [];
  const deps: ProbeDeps = {
    mint: vi.fn(async (audience: string) => `jwt-for:${audience}`),
    connect: vi.fn(async (jwt: string) => {
      if (jwt !== `jwt-for:${opts.listed}` && !opts.leakForeign)
        throw new Error('closed (1008): jwt_validation_failed');
      return {
        call: async (method: string) => {
          calls.push(method);
          if (method === 'config.schema' && opts.role !== 'admin')
            throw new Error('missing scope: operator.admin');
          return {};
        },
        close: vi.fn(),
      };
    }),
  };
  return { deps, calls };
}

describe('runProbe', () => {
  it('passes for a member: read and write allowed, admin refused, foreign aud refused', async () => {
    const { deps, calls } = fakeGateway({ listed: 'gw:a', role: 'user' });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['health', 'status', 'auth.refresh', 'config.schema']);
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
    const { deps } = fakeGateway({ listed: 'gw:a', role: 'user', leakForeign: true });
    const result = await runProbe({ audience: 'gw:a', isPlatformAdmin: false, deps });
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatchObject({ expected: 'refused', actual: 'allowed' });
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
    expect(probeMatrix(false).map((p) => [p.method, p.expect])).toEqual([
      ['health', 'allowed'],
      ['status', 'allowed'],
      ['auth.refresh', 'allowed'],
      ['config.schema', 'refused'],
    ]);
  });
});
