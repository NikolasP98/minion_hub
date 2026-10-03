import { reliabilityReply } from './__fixtures__/responses';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchReliabilityViewOwner } from './view-owner';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  loadReliabilityActivity,
  loadReliabilityEvents,
  loadReliabilityFlow,
  loadReliabilityPerf,
  loadReliabilitySummary,
  loadReliabilitySummaryAll,
  loadReliabilityTimeline,
  loadReliabilityUsage,
  reliability,
  resetReliability,
  setReliabilityOwner,
  pushReliabilityEvent,
  setReliabilitySampleFilters,
  setReliabilityQueryKeys,
} from './reliability.svelte';

const methods = ['summary', 'events', 'timeline', 'flow', 'usage', 'activity', 'perf'].map(
  (name) => `reliability.${name}`,
);
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
function connect(
  request: (method: string, params?: unknown) => Promise<unknown>,
  advertised: string[] | null = methods,
) {
  const owner = publishGatewaySessionOwner({
    actorId: 'actor',
    orgId: 'org',
    hostId: 'host',
    hostUrl: 'wss://example.test',
    methods: advertised,
    current: () => true,
    request,
  });
  setReliabilityOwner(owner);
  return owner;
}
const event = (timestamp: number) => ({
  timestamp,
  category: 'tool',
  severity: 'high',
  event: 'tool.completed',
  message: 'Synthetic event',
});
const cases = [
  {
    name: 'summary',
    load: (from: number) => loadReliabilitySummary('host', from, from + 1),
    method: 'summary',
  },
  {
    name: 'summaryAll',
    load: (from: number) => loadReliabilitySummaryAll('host', from, from + 1),
    method: 'summary',
  },
  {
    name: 'events',
    load: (from: number) => loadReliabilityEvents('host', { from, to: from + 1 }),
    method: 'events',
  },
  {
    name: 'timeline',
    load: (from: number) => loadReliabilityTimeline(from, from + 1),
    method: 'timeline',
  },
  { name: 'flow', load: (from: number) => loadReliabilityFlow(from, from + 1), method: 'flow' },
  { name: 'usage', load: (from: number) => loadReliabilityUsage(from, from + 1), method: 'usage' },
  {
    name: 'activity',
    load: (from: number) => loadReliabilityActivity(from, from + 1),
    method: 'activity',
  },
  { name: 'perf', load: (from: number) => loadReliabilityPerf(from, from + 1), method: 'perf' },
] as const;
const loadedCases = cases.map((entry) => ({
  ...entry,
  reply: (n: number) => reliabilityReply(`reliability.${entry.method}`, n),
}));

afterEach(() => {
  resetReliability();
  setReliabilityQueryKeys(null);
  retireGatewaySessionOwner();
  vi.useRealTimers();
});

describe.each(loadedCases)('production $name loader ownership', ({ name, load, reply }) => {
  it.each(['resolve', 'reject'] as const)(
    'ignores old %s after the current query publishes',
    async (outcome) => {
      const a = deferred(),
        b = deferred();
      connect(vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
      const first = load(10),
        second = load(20);
      b.resolve(reply(222));
      await second;
      const latest = structuredClone(reliability[name]);
      if (outcome === 'resolve') a.resolve(reply(111));
      else a.reject(new Error('Old failure'));
      await first;
      expect(reliability[name]).toEqual(latest);
      expect(reliability.states[name]).toBe('ready');
    },
  );

  it('cannot clear a newer pending state when the old query finishes', async () => {
    const a = deferred(),
      b = deferred();
    connect(vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
    const first = load(10),
      second = load(20);
    a.resolve(reply(111));
    await first;
    expect(reliability.states[name]).toBe('loading');
    expect(reliability.loading).toBe(true);
    expect(reliability[name]).toEqual(name === 'events' ? [] : null);
    b.resolve(reply(222));
    await second;
    expect(reliability.states[name]).toBe('ready');
  });

  it('retires old session results even with identical clock timestamps and query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = deferred();
    const old = connect(() => a.promise);
    const first = load(10);
    const current = connect(async () => reply(222));
    expect(current.token).not.toBe(old.token);
    await load(10);
    const latest = structuredClone(reliability[name]);
    a.resolve(reply(111));
    await first;
    expect(reliability[name]).toEqual(latest);
    expect(reliability.states[name]).toBe('ready');
  });

  it('retains the same-query snapshot on refresh failure but clears a different query', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply(111))
      .mockRejectedValue(new Error('Unavailable'));
    connect(request);
    await load(10);
    const saved = structuredClone(reliability[name]);
    await load(10);
    expect(reliability[name]).toEqual(saved);
    expect(reliability.states[name]).toBe('failed');
    await load(20);
    expect(reliability[name]).toEqual(name === 'events' ? [] : null);
    expect(reliability.states[name]).toBe('failed');
  });

  it('does not publish after a reset while the actual endpoint is pending', async () => {
    const pending = deferred();
    connect(() => pending.promise);
    const read = load(10);
    resetReliability();
    pending.resolve(reply(444));
    await read;
    expect(reliability.states[name]).toBe('idle');
    expect(reliability[name as keyof typeof reliability]).toEqual(name === 'events' ? [] : null);
  });
  it('fences a changed visible query before the replacement effect starts', async () => {
    const pending = deferred();
    let key = 'query-a';
    setReliabilityQueryKeys({ date: () => key, filtered: () => key });
    connect(() => pending.promise);
    const read = load(10);
    key = 'query-b';
    pending.resolve(reply(444));
    await read;
    expect(reliability[name as keyof typeof reliability]).toEqual(name === 'events' ? [] : null);
    setReliabilityQueryKeys(null);
  });

  it('distinguishes missing advertised method from missing capability inventory', async () => {
    const request = vi.fn(async () => reply(111));
    connect(request, []);
    await load(10);
    expect(reliability.states[name]).toBe('unsupported');
    expect(request).not.toHaveBeenCalled();
    connect(request, null);
    await load(10);
    expect(reliability.states[name]).toBe('unavailable');
    expect(request).not.toHaveBeenCalled();
  });
});

it('normalizes equivalent filter order in actual RPC parameters', async () => {
  const request = vi.fn(async (_method: string, _params?: unknown) => loadedCases[0].reply(1));
  connect(request);
  await loadReliabilitySummary('host', 0, 10, { severities: ['high', 'low', 'high'] });
  await loadReliabilitySummary('host', 0, 10, { severities: ['low', 'high'] });
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  expect(request.mock.calls[0]?.[1]).toEqual({ since: 0, until: 10, severities: ['high', 'low'] });
});

it('bounds live samples, applies filters and never fabricates summary increments', async () => {
  const owner = connect(async (method) =>
    method === 'reliability.events' ? { events: [] } : loadedCases[0].reply(50),
  );
  reliability.dateRange.from = 0;
  reliability.dateRange.to = 5000;
  setReliabilitySampleFilters({ severities: ['high'], categories: ['tool'] });
  await loadReliabilitySummary('host', 0, 5000);
  await loadReliabilityEvents('host', { from: 0, to: 5000 });
  for (let n = 1; n <= 2005; n++) pushReliabilityEvent(event(n), owner);
  pushReliabilityEvent({ ...event(2010), severity: 'low' }, owner);
  pushReliabilityEvent(event(6000), owner);
  expect(reliability.events).toHaveLength(2000);
  expect(reliability.events[0]?.timestamp).toBe(2005);
  expect(reliability.events.every((row) => row.severity === 'high' && row.timestamp <= 5000)).toBe(
    true,
  );
  expect(reliability.recentEvents).toHaveLength(200);
  expect(reliability.summary?.total).toBe(50);
  retireGatewaySessionOwner(owner);
  pushReliabilityEvent(event(3000), owner);
  expect(reliability.events).toEqual([]);
  resetReliability();
  expect(reliability.events).toEqual([]);
  expect(reliability.recentEvents).toEqual([]);
});

it.each(['actorId', 'orgId', 'hostId', 'hostUrl'] as const)(
  'fences changed canonical %s before the next route effect',
  async (field) => {
    const pending = deferred();
    const session = connect(() => pending.promise);
    const identity = {
      actorId: 'actor',
      orgId: 'org',
      hostId: 'host',
      hostUrl: 'wss://example.test',
    };
    setReliabilityOwner(null);
    setReliabilityOwner(matchReliabilityViewOwner(session, () => identity));
    const read = loadReliabilitySummary('host', 10, 11);
    identity[field] = 'changed';
    pending.resolve(loadedCases[0].reply(444));
    await read;
    expect(reliability.summary).toBeNull();
    expect(matchReliabilityViewOwner(session, () => identity)).toBeNull();
  },
);
