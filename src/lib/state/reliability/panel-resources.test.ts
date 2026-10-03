import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import { createCredentialHealthState } from './credential-health.svelte';
import { createInsightsState } from './insights.svelte';
import { createPluginHealthState } from './plugin-health.svelte';
import { createSkillStatsState } from './skill-stats.svelte';
import { createReliabilityHttpOwner } from './view-owner';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./http-read', () => ({
  fetchReliabilityJson: mocks.fetch,
  RELIABILITY_HTTP_MAX_BYTES: 8 * 1024 * 1024,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function insight(from: number, to: number) {
  return {
    insights: {
      window: { from, to },
      signalToNoise: { total: 0, signal: 0, noise: 0, noisePct: 0 },
      noiseTrend: [],
      categoryVolume: [],
      topClusters: [],
      healthRegressions: [],
      costOutliers: [],
      reconnectStorms: [],
      proposedActions: [],
      generatedAt: to,
    },
  };
}

function plugin(from: number, to: number, id: string) {
  return {
    plugins: [
      {
        pluginId: id,
        name: id,
        origin: 'bundled',
        source: id,
        status: 'loaded',
        enabled: true,
        configEnabled: true,
        capabilities: Object.fromEntries(
          [
            'tools',
            'hooks',
            'channels',
            'providers',
            'gatewayMethods',
            'httpHandlers',
            'cliCommands',
            'services',
            'commands',
            'flowNodes',
            'flows',
          ].map((key) => [key, 0]),
        ),
        channelIds: [],
        providerIds: [],
        toolNames: [],
        telemetry: {
          totalEvents: 0,
          bySeverity: {},
          errors: 0,
          lastActivityAt: null,
          lastError: null,
          topFailureModes: [],
        },
      },
    ],
    capturedAt: to,
    period: { start: from, end: to },
  };
}

afterEach(() => mocks.fetch.mockReset());

describe('owner-fenced panel resources', () => {
  it('lets a new plugin session publish without waiting for an abandoned session', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    let active = 'a';
    const gateway = (id: string, request: GatewaySessionOwner['request']): GatewaySessionOwner => ({
      token: Symbol(id),
      actorId: `actor-${id}`,
      orgId: `org-${id}`,
      hostId: 'host',
      hostUrl: 'wss://gateway.test',
      methods: ['reliability.plugins'],
      current: () => active === id,
      request,
    });
    const ownerA = gateway('a', () => a.promise);
    const ownerB = gateway('b', () => b.promise);
    let current: GatewaySessionOwner | null = ownerA;
    const state = createPluginHealthState(() => current);
    const first = state.load('host', 10, 20);
    active = 'b';
    current = ownerB;
    const second = state.load('host', 30, 40);
    b.resolve(plugin(30, 40, 'current'));
    await second;
    a.resolve(plugin(10, 20, 'stale'));
    await first;
    expect(state.snapshot?.plugins[0]?.pluginId).toBe('current');
  });

  it('distinguishes unsupported inventory from an advertised transport failure', async () => {
    const request = vi.fn(async () => {
      throw new Error('private transport detail');
    });
    const base = {
      token: Symbol('gateway'),
      actorId: 'actor',
      orgId: 'org',
      hostId: 'host',
      hostUrl: 'wss://gateway.test',
      current: () => true,
      request,
    };
    let current: GatewaySessionOwner = { ...base, methods: [] };
    const state = createPluginHealthState(() => current);
    await state.load('host', 10, 20);
    expect(state.status).toBe('unsupported');
    expect(request).not.toHaveBeenCalled();
    current = { ...base, token: Symbol('next'), methods: ['reliability.plugins'] };
    await state.load('host', 10, 20);
    expect(state.status).toBe('failed');
    expect(state.error).not.toContain('private');
  });

  it('fences old and malformed HTTP insights across actor/query changes', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    mocks.fetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const identity = { actorId: 'actor-a', orgId: 'org', serverId: 'host', queryKey: '10:20' };
    const owner = createReliabilityHttpOwner(() => identity);
    const state = createInsightsState(owner);
    const first = state.load('host', 10, 20);
    identity.actorId = 'actor-b';
    identity.queryKey = '30:40';
    const second = state.load('host', 30, 40);
    b.resolve(insight(30, 40));
    await second;
    a.resolve(insight(10, 20));
    await first;
    expect(state.snapshot?.window).toEqual({ from: 30, to: 40 });

    mocks.fetch.mockResolvedValueOnce({ insights: { malformed: true } });
    await state.load('host', 30, 40);
    expect(state.status).toBe('failed');
    expect(state.snapshot?.window).toEqual({ from: 30, to: 40 });
  });

  it('fences skill and credential data immediately when canonical owner changes', async () => {
    const identity = { actorId: 'actor', orgId: 'org', serverId: 'host', queryKey: 'host' };
    const owner = createReliabilityHttpOwner(() => identity);
    mocks.fetch
      .mockResolvedValueOnce({
        bySkill: [
          {
            skillName: 'calendar',
            status: 'ok',
            count: 1,
            durationCount: 1,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        snapshots: [
          {
            id: 1,
            serverId: 'host',
            capturedAt: 1,
            snapshotJson: '{"providers":[]}',
          },
        ],
      });
    const skills = createSkillStatsState(owner);
    const credentials = createCredentialHealthState(owner);
    await skills.load('host');
    await credentials.load('host');
    expect(skills.bySkill).toHaveLength(1);
    expect(credentials.snapshots).toHaveLength(1);
    identity.orgId = 'other';
    expect(skills.bySkill).toEqual([]);
    expect(credentials.snapshots).toEqual([]);
    expect(skills.status).toBe('unavailable');
    expect(credentials.status).toBe('unavailable');
  });
});
