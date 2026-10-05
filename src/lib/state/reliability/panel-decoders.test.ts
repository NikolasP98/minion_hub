import { describe, expect, it } from 'vitest';
import { decodeArchitectureSnapshot } from './architecture.svelte';
import { decodeCredentialSnapshots } from './credential-health.svelte';
import { decodeInsightsResult } from './insights.svelte';
import { decodePluginHealthSnapshot } from './plugin-health.svelte';
import { aggregateSkillRows, decodeSkillRows } from './skill-stats.svelte';

const plugin = {
  pluginId: 'alpha',
  name: 'Alpha',
  origin: 'bundled',
  source: 'plugins/alpha',
  status: 'loaded',
  enabled: true,
  configEnabled: true,
  capabilities: {
    tools: 1,
    hooks: 0,
    channels: 0,
    providers: 0,
    gatewayMethods: 1,
    httpHandlers: 0,
    cliCommands: 0,
    services: 0,
    commands: 0,
    flowNodes: 0,
    flows: 0,
  },
  channelIds: [],
  providerIds: [],
  toolNames: ['alpha.run'],
  telemetry: {
    totalEvents: 2,
    bySeverity: { info: 2 },
    errors: 0,
    lastActivityAt: 20,
    lastError: null,
    topFailureModes: [],
  },
};

const insights = {
  window: { from: 10, to: 20 },
  signalToNoise: { total: 2, signal: 1, noise: 1, noisePct: 0.5 },
  noiseTrend: [{ bucket: '2026-10-03', total: 2, noise: 1, signal: 1 }],
  categoryVolume: [{ category: 'tool', n: 2, pct: 1 }],
  topClusters: [
    { event: 'tool.failed', msgKey: 'failed', severity: 'high', n: 2, prevN: 0, deltaPct: null },
  ],
  healthRegressions: [],
  costOutliers: [],
  reconnectStorms: [],
  proposedActions: [
    {
      id: 'action',
      detector: 'recurring_failure',
      severity: 'warning',
      title: 'Recurring failure',
      evidence: 'Two failures',
      suggestedFix: 'Inspect the tool',
      metricRef: { event: 'tool.failed' },
      generatedAt: 20,
    },
  ],
  generatedAt: 20,
};

const architecture = {
  nodes: [
    {
      id: 'hub',
      name: 'Hub',
      kind: 'app',
      network: 'vercel',
      fn: 'app',
      x: 0,
      y: 0,
      icon: 'Globe',
      endpoints: ['https :443'],
      description: 'Hub application',
      status: 'ok',
      statusDetail: 'Serving this request.',
    },
  ],
  edges: [],
  c4: {
    nodes: [
      {
        id: 'c4:hub',
        name: 'Hub',
        level: 'context',
        parentId: null,
        description: 'Hub',
        technology: 'SvelteKit',
        icon: 'Globe',
        sourceRefs: ['src'],
        artefacts: ['/reliability'],
        reconStatus: 'verified',
        statusNodeId: 'hub',
      },
    ],
    relations: [],
    generatedFrom: 'source',
  },
  checkedAt: 20,
};

describe('reliability panel wire decoders', () => {
  it('accepts complete valid plugin, insight, credential and architecture projections', () => {
    expect(
      decodePluginHealthSnapshot(
        { plugins: [plugin], capturedAt: 20, period: { start: 10, end: 20 } },
        { from: 10, to: 20 },
      ).plugins[0]?.pluginId,
    ).toBe('alpha');
    expect(decodeInsightsResult(insights, { from: 10, to: 20 }).signalToNoise.total).toBe(2);
    expect(
      decodeCredentialSnapshots(
        {
          snapshots: [
            {
              id: 1,
              serverId: 'gateway-a',
              capturedAt: 20,
              snapshotJson: JSON.stringify({
                providers: [
                  { provider: 'openai', profileId: 'default', status: 'ok', expiresAt: null },
                ],
              }),
            },
          ],
        },
        'gateway-a',
      )[0]?.providers[0]?.status,
    ).toBe('ok');
    expect(decodeArchitectureSnapshot(architecture).nodes[0]?.id).toBe('hub');
  });

  it('rejects malformed nested success shapes instead of publishing healthy empties', () => {
    expect(() =>
      decodePluginHealthSnapshot(
        {
          plugins: [{ ...plugin, status: 'mystery' }],
          capturedAt: 20,
          period: { start: 10, end: 20 },
        },
        { from: 10, to: 20 },
      ),
    ).toThrow();
    expect(() =>
      decodeInsightsResult(
        { ...insights, noiseTrend: [{ bucket: 'x', total: 2, noise: 2, signal: 2 }] },
        { from: 10, to: 20 },
      ),
    ).toThrow();
    expect(() =>
      decodeCredentialSnapshots(
        {
          snapshots: [{ id: 1, serverId: 'gateway-a', capturedAt: 20, snapshotJson: '{not json' }],
        },
        'gateway-a',
      ),
    ).toThrow();
    expect(() =>
      decodeArchitectureSnapshot({
        ...architecture,
        edges: [{ source: 'hub', target: 'missing', via: 'invalid' }],
      }),
    ).toThrow();
  });

  it('rejects duplicate identities, cycles, oversized entity sets and foreign owners', () => {
    expect(() =>
      decodePluginHealthSnapshot(
        {
          plugins: [plugin, plugin],
          capturedAt: 20,
          period: { start: 10, end: 20 },
        },
        { from: 10, to: 20 },
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      decodeCredentialSnapshots(
        {
          snapshots: [
            {
              id: 1,
              serverId: 'gateway-b',
              capturedAt: 20,
              snapshotJson: '{"providers":[]}',
            },
          ],
        },
        'gateway-a',
      ),
    ).toThrow(/owner/);
    const cyclicNode = {
      ...architecture.c4.nodes[0],
      id: 'cycle',
      parentId: 'cycle',
      statusNodeId: undefined,
    };
    expect(() =>
      decodeArchitectureSnapshot({
        ...architecture,
        c4: { ...architecture.c4, nodes: [cyclicNode] },
      }),
    ).toThrow(/Cyclic/);
    expect(() =>
      decodeArchitectureSnapshot({
        ...architecture,
        nodes: Array.from({ length: 2001 }, (_, id) => ({
          ...architecture.nodes[0],
          id: String(id),
        })),
      }),
    ).toThrow();
  });
});

describe('skill duration authority', () => {
  it('weights only measured samples, keeps real measured zero and treats old rows as unknown', () => {
    const rows = decodeSkillRows({
      bySkill: [
        {
          skillName: 'calendar',
          status: 'ok',
          count: 10,
          durationCount: 2,
          avgDurationMs: 10,
          minDurationMs: 0,
          maxDurationMs: 20,
        },
        {
          skillName: 'calendar',
          status: 'error',
          count: 100,
          durationCount: 1,
          avgDurationMs: 40,
          minDurationMs: 40,
          maxDurationMs: 40,
        },
        {
          skillName: 'old-contract',
          status: 'ok',
          count: 5,
          avgDurationMs: 3,
          minDurationMs: 3,
          maxDurationMs: 3,
        },
        {
          skillName: 'measured-zero',
          status: 'ok',
          count: 1,
          durationCount: 1,
          avgDurationMs: 0,
          minDurationMs: 0,
          maxDurationMs: 0,
        },
      ],
    });
    const aggregate = aggregateSkillRows(rows);
    const oldAllExecutionWeight = (10 * 10 + 40 * 100) / 110;
    expect(aggregate.find((row) => row.skillName === 'calendar')).toMatchObject({
      total: 110,
      durationCount: 3,
      avgDurationMs: 20,
      minDurationMs: 0,
      maxDurationMs: 40,
    });
    expect(aggregate.find((row) => row.skillName === 'calendar')?.avgDurationMs).not.toBe(
      oldAllExecutionWeight,
    );
    expect(aggregate.find((row) => row.skillName === 'old-contract')).toMatchObject({
      durationCount: 0,
      avgDurationMs: null,
    });
    expect(aggregate.find((row) => row.skillName === 'measured-zero')).toMatchObject({
      durationCount: 1,
      avgDurationMs: 0,
    });
  });

  it('rejects inconsistent measured counts and duration shapes', () => {
    expect(() =>
      decodeSkillRows({
        bySkill: [
          {
            skillName: 'bad',
            status: 'ok',
            count: 1,
            durationCount: 2,
            avgDurationMs: 1,
            minDurationMs: 1,
            maxDurationMs: 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeSkillRows({
        bySkill: [
          {
            skillName: 'bad',
            status: 'ok',
            count: 1,
            durationCount: 0,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeSkillRows({
        bySkill: [
          {
            skillName: 'bad-order',
            status: 'ok',
            count: 1,
            durationCount: 1,
            avgDurationMs: 5,
            minDurationMs: 6,
            maxDurationMs: 7,
          },
        ],
      }),
    ).toThrow(/ordering/);
    expect(() =>
      decodeSkillRows({
        bySkill: [
          {
            skillName: 'duplicate',
            status: 'ok',
            count: 1,
            durationCount: 1,
            avgDurationMs: 1,
            minDurationMs: 1,
            maxDurationMs: 1,
          },
          {
            skillName: 'duplicate',
            status: 'ok',
            count: 1,
            durationCount: 1,
            avgDurationMs: 1,
            minDurationMs: 1,
            maxDurationMs: 1,
          },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      aggregateSkillRows([
        {
          skillName: 'overflow',
          status: 'ok',
          count: Number.MAX_SAFE_INTEGER,
          durationCount: 0,
          avgDurationMs: null,
          minDurationMs: null,
          maxDurationMs: null,
        },
        {
          skillName: 'overflow',
          status: 'error',
          count: 1,
          durationCount: 0,
          avgDurationMs: null,
          minDurationMs: null,
          maxDurationMs: null,
        },
      ]),
    ).toThrow(/numeric bounds/);
  });
});
