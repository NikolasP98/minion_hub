// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reliabilityReply } from './__fixtures__/responses';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  loadReliabilitySummary,
  loadReliabilitySummaryAll,
  loadReliabilityEvents,
  loadReliabilityTimeline,
  loadReliabilityFlow,
  loadReliabilityUsage,
  loadReliabilityActivity,
  loadReliabilityPerf,
  reliability,
  resetReliability,
  setReliabilityOwner,
  setReliabilityQueryKeys,
} from './reliability.svelte';

const loads = {
  summary: () => loadReliabilitySummary('host', 1, 2),
  summaryAll: () => loadReliabilitySummaryAll('host', 1, 2),
  events: () => loadReliabilityEvents('host', { from: 1, to: 2 }),
  timeline: () => loadReliabilityTimeline(1, 2),
  flow: () => loadReliabilityFlow(1, 2),
  usage: () => loadReliabilityUsage(1, 2),
  activity: () => loadReliabilityActivity(1, 2),
  perf: () => loadReliabilityPerf(1, 2),
};
type Name = keyof typeof loads;
const invalid: [Name, string, unknown][] = [
  ['summary', 'byCategory.tool', 'four'],
  ['summaryAll', 'bySeverity.high', Infinity],
  ['summary', 'uptimeSinceMs', NaN],
  ['events', 'events.0.metadata', []],
  ['events', 'events.0.timestamp', Infinity],
  ['events', 'events.0.agentId', {}],
  ['timeline', 'buckets.0.count', NaN],
  ['timeline', 'bucketMs', Infinity],
  ['timeline', 'buckets.0.category', null],
  ['flow', 'rows.0.count', -1],
  ['flow', 'rows.0.severity', {}],
  ['usage', 'total', {}],
  ['usage', 'timeline', [{ t: 1 }]],
  ['usage', 'buckets', [{ model: 'x' }]],
  ['usage', 'eventCount', Infinity],
  ['activity', 'memory.byType', null],
  ['activity', 'tools.top', [{ key: 'tool' }]],
  ['activity', 'heartbeat.lastStatus', {}],
  ['activity', 'proactivity.total', 'zero'],
  ['activity', 'toolOutcomes', {}],
  ['perf', 'snapshots', [{ ts: 1 }]],
  ['perf', 'latest.latencyMs.p99', Infinity],
  ['perf', 'snapshots.0.eventLoopDelayMs.mean', NaN],
  ['perf', 'snapshots.0.slowestMethods', [{ method: 'x' }]],
  ['perf', 'latest.errorRate', 2],
  ['events', 'events', new Array(2001).fill({})],
  ['flow', 'rows', new Array(20_001).fill({})],
  ['perf', 'snapshots', new Array(5001).fill({})],
];
function mutate(raw: unknown, path: string, replacement: unknown) {
  let target = raw as Record<string, unknown>;
  const parts = path.split('.');
  for (const key of parts.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[parts.at(-1)!] = replacement;
  return raw;
}
function connect(request: (method: string) => Promise<unknown>) {
  const owner = publishGatewaySessionOwner({
    actorId: 'private-actor',
    orgId: 'private-org',
    hostId: 'host',
    hostUrl: 'wss://example.invalid',
    methods: Object.keys(loads).map(
      (key) => `reliability.${key === 'summaryAll' ? 'summary' : key}`,
    ),
    current: () => true,
    request,
  });
  setReliabilityOwner(owner);
  return owner;
}
afterEach(() => {
  resetReliability();
  retireGatewaySessionOwner();
  setReliabilityQueryKeys(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(invalid)('%s rejects malformed %s', (name, path, invalidValue) => {
  it('contains the failure and admits no malformed projection', async () => {
    const method = `reliability.${name === 'summaryAll' ? 'summary' : name}`;
    connect(async () => mutate(reliabilityReply(method), path, invalidValue));
    await expect(loads[name]()).resolves.toBeUndefined();
    expect(reliability.states[name]).toBe('failed');
    expect(reliability[name]).toEqual(name === 'events' ? [] : null);
  });
});

it('reports sanitized current failures once per episode and bounds retry telemetry', async () => {
  vi.useFakeTimers();
  const capture = vi.fn();
  vi.stubGlobal('window', { posthog: { capture } });
  let fail = true;
  connect(async (method) => {
    if (fail) throw new Error('secret response private-org');
    return reliabilityReply(method);
  });
  await loads.summary();
  await loads.summary();
  expect(capture.mock.calls).toEqual([
    ['reliability_read_failed', { resource: 'summary', phase: 'transport', schema_version: 1 }],
  ]);
  fail = false;
  await loads.summary();
  fail = true;
  await loads.summary();
  expect(capture).toHaveBeenCalledTimes(1);
  fail = false;
  await loads.summary();
  await vi.advanceTimersByTimeAsync(60_000);
  fail = true;
  await loads.summary();
  expect(capture).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(capture.mock.calls)).not.toMatch(/private|secret|host|query|since/);
});

it('reports decode failures without serializing the response and ignores stale failures', async () => {
  const capture = vi.fn();
  vi.stubGlobal('window', { posthog: { capture } });
  let reject!: (error: unknown) => void;
  connect(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const old = loads.usage();
  connect(async () => ({ secret: 'never capture me' }));
  await loads.usage();
  reject(new Error('late-secret'));
  await old;
  expect(capture.mock.calls).toEqual([
    ['reliability_read_failed', { resource: 'usage', phase: 'decode', schema_version: 1 }],
  ]);
});

it('keeps failures contained when monitoring is absent or throws', async () => {
  const capture = vi.fn(() => {
    throw new Error('sdk');
  });
  vi.stubGlobal('window', { posthog: { capture } });
  connect(async () => {
    throw new Error('transport');
  });
  await expect(loads.perf()).resolves.toBeUndefined();
  expect(reliability.states.perf).toBe('failed');
});
