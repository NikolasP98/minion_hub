// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { reliabilityReply } from './__fixtures__/responses';
import Harness from './__fixtures__/CoordinatorHarness.svelte';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  pushReliabilityEvent,
  reliability,
  resetReliability,
  setReliabilityQueryKeys,
} from './reliability.svelte';
const methods = ['summary', 'events', 'timeline', 'flow', 'usage', 'activity', 'perf'].map(
  (name) => `reliability.${name}`,
);
const query = { from: 10, to: 100, severities: ['high', 'low'], categories: ['tool'] };
const reply = reliabilityReply;
function connect(request = vi.fn(async (method: string, _params?: unknown) => reply(method))) {
  const owner = publishGatewaySessionOwner({
    actorId: 'actor',
    orgId: 'org',
    hostId: 'host',
    hostUrl: 'wss://test.invalid',
    methods,
    current: () => true,
    request,
  });
  return { owner, request };
}
async function flush() {
  await tick();
  await Promise.resolve();
  await tick();
}
afterEach(() => {
  cleanup();
  resetReliability();
  retireGatewaySessionOwner();
  setReliabilityQueryKeys(null);
  vi.useRealTimers();
});

describe('mounted production reliability coordinator', () => {
  it('loads once after mount initialization, normalizes equivalent filters, and refreshes both groups', async () => {
    const { owner, request } = connect();
    const view = render(Harness, { owner, query });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(8));
    await waitFor(() => expect(reliability.loading).toBe(false));
    expect(request.mock.calls.filter(([method]) => method === 'reliability.summary')).toHaveLength(
      2,
    );
    await view.rerender({ owner, query: { ...query, severities: ['low', 'high', 'high'] } });
    await flush();
    expect(request).toHaveBeenCalledTimes(8);
    await view.rerender({ owner, query: { ...query, categories: ['agent'] } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(12));
    expect(request.mock.calls.slice(8).map(([method]) => method)).toEqual([
      'reliability.summary',
      'reliability.timeline',
      'reliability.flow',
      'reliability.events',
    ]);
    await waitFor(() => expect(reliability.loading).toBe(false));
    await fireEvent.click(view.getByRole('button', { name: 'Refresh metrics' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(20));
  });
  it('does not publish from an abandoned owner, even while its network requests remain pending', async () => {
    let resolveOld!: (raw: unknown) => void;
    const old = connect(
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      ),
    );
    const view = render(Harness, { owner: old.owner, query });
    await waitFor(() => expect(old.request).toHaveBeenCalledTimes(8));
    const next = connect();
    await view.rerender({ owner: next.owner, query });
    await waitFor(() => expect(reliability.summary?.total).toBe(4));
    resolveOld({ snapshots: [{ stale: true }] });
    await flush();
    expect(reliability.perf?.snapshots[0]?.ts).toBe(4);
    await view.rerender({ owner: null, query });
    await flush();
    expect(reliability.summary).toBeNull();
    expect(reliability.loading).toBe(false);
  });
  it('shows refresh failure and a real retry while keeping the same-query snapshot', async () => {
    let fail = false;
    const { owner, request } = connect(
      vi.fn(async (method) => {
        if (fail) throw new Error('Private transport detail');
        return reply(method);
      }),
    );
    const view = render(Harness, { owner, query, persistenceUnavailable: true });
    await waitFor(() => expect(reliability.summary?.total).toBe(4));
    expect(view.getByText(/Filters work for this visit/)).toBeTruthy();
    fail = true;
    await fireEvent.click(view.getByRole('button', { name: 'Refresh metrics' }));
    await waitFor(() => expect(view.getAllByRole('alert')).toHaveLength(8));
    expect(reliability.summary?.total).toBe(4);
    expect(view.container.textContent).not.toContain('Private transport detail');
    fail = false;
    await fireEvent.click(view.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(view.queryAllByRole('alert')).toHaveLength(0));
    expect(request).toHaveBeenCalledTimes(24);
  });
  it('retires live timers on query switch and unmount without serializing new reads behind an old batch', async () => {
    vi.useFakeTimers();
    const pending = connect(vi.fn(() => new Promise(() => {})));
    const view = render(Harness, { owner: pending.owner, query });
    await flush();
    expect(pending.request).toHaveBeenCalledTimes(8);
    reliability.dateRange.from = 10;
    reliability.dateRange.to = 100;
    for (let i = 0; i < 30; i++)
      pushReliabilityEvent(
        {
          timestamp: 50,
          category: 'tool',
          severity: 'high',
          event: 'tool.ok',
          message: 'Synthetic',
        },
        pending.owner,
      );
    await vi.advanceTimersByTimeAsync(5000);
    expect(pending.request).toHaveBeenCalledTimes(8);
    await view.rerender({ owner: pending.owner, query: { ...query, from: 20 } });
    await flush();
    expect(pending.request).toHaveBeenCalledTimes(16);
    flushSync(() => {});
    view.unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(pending.request).toHaveBeenCalledTimes(16);
  });
  it('ignores out-of-range live events and coalesces a current-range event into one fresh batch', async () => {
    vi.useFakeTimers();
    const { owner, request } = connect();
    const view = render(Harness, { owner, query });
    await flush();
    expect(request).toHaveBeenCalledTimes(8);
    pushReliabilityEvent(
      {
        timestamp: 101,
        category: 'tool',
        severity: 'high',
        event: 'tool.outside',
        message: 'Outside visible range',
      },
      owner,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledTimes(8);
    pushReliabilityEvent(
      {
        timestamp: 50,
        category: 'tool',
        severity: 'high',
        event: 'tool.current',
        message: 'Inside visible range',
      },
      owner,
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(request).toHaveBeenCalledTimes(16);
    view.unmount();
  });
  it('renders unsupported separately from a failed advertised method', async () => {
    const request = vi.fn(async () => {
      throw new Error('network');
    });
    const owner = publishGatewaySessionOwner({
      actorId: 'actor',
      orgId: 'org',
      hostId: 'host',
      hostUrl: 'wss://test.invalid',
      methods: [],
      current: () => true,
      request,
    });
    const view = render(Harness, { owner, query });
    await waitFor(() =>
      expect(view.getAllByText(/This gateway does not provide this data/)).toHaveLength(8),
    );
    expect(request).not.toHaveBeenCalled();
    expect(view.queryAllByRole('button', { name: 'Retry' })).toHaveLength(0);
  });
});

it.each(['range', 'filter'] as const)(
  'hides settled A immediately when the visible %s becomes pending B, including an intervening live event',
  async (kind) => {
    let pending = false;
    const { owner, request } = connect(
      vi.fn((method) => (pending ? new Promise(() => {}) : Promise.resolve(reply(method)))),
    );
    const nextQuery =
      kind === 'range' ? { ...query, from: 20 } : { ...query, categories: ['agent'] };
    const observations: unknown[] = [];
    const view = render(Harness, {
      owner,
      query,
      nextQuery,
      onQueryChange: () => {
        observations.push(reliability.summary, reliability.summaryAll);
        pushReliabilityEvent(
          {
            timestamp: 50,
            category: 'tool',
            severity: 'high',
            event: 'tool.ok',
            message: 'Late A sample',
          },
          owner,
        );
        observations.push(reliability.events);
      },
    });
    await waitFor(() => expect(view.getByTestId('summary').textContent).toContain('"total":4'));
    await waitFor(() => expect(reliability.loading).toBe(false));
    reliability.dateRange.from = 10;
    reliability.dateRange.to = 100;
    pending = true;
    await fireEvent.click(view.getByRole('button', { name: 'Change query' }));
    expect(observations[0]).toBeNull();
    expect(observations[1]).toEqual(
      kind === 'range'
        ? null
        : { total: 4, byCategory: { tool: 4 }, bySeverity: { high: 4 }, uptimeSinceMs: undefined },
    );
    expect(observations[2]).toEqual([]);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(kind === 'range' ? 16 : 12));
    expect(view.getByTestId('summary').textContent).toBe('null');
    expect(view.getByTestId('events').textContent).toBe('[]');
    expect(view.getByTestId('query').textContent).toBe(JSON.stringify(nextQuery));
  },
);

it('renders failed notices for malformed successful responses without a route exception', async () => {
  const { owner } = connect(vi.fn(async () => ({ malformed: true })));
  const view = render(Harness, { owner, query });
  await waitFor(() => expect(view.getAllByRole('alert')).toHaveLength(8));
  expect(view.getByTestId('all-data').textContent).toBe('[null,null,[],null,null,null,null,null]');
  expect(view.getAllByRole('button', { name: 'Retry' })).toHaveLength(8);
});

it('retries all eight gateway reads on the performance tab while the toolbar only refreshes that panel', async () => {
  let fail = true;
  const { owner, request } = connect(
    vi.fn(async (method) => {
      if (fail) throw new Error('Synthetic read unavailable');
      return reply(method);
    }),
  );
  const view = render(Harness, { owner, query, activeTab: 'performance' });
  await waitFor(() => expect(view.getAllByRole('alert')).toHaveLength(8));
  expect(request).toHaveBeenCalledTimes(8);
  await fireEvent.click(view.getByRole('button', { name: 'Refresh metrics' }));
  expect(view.getByTestId('performance-refresh').textContent).toBe('1');
  expect(request).toHaveBeenCalledTimes(8);
  fail = false;
  await fireEvent.click(view.getAllByRole('button', { name: 'Retry' })[7]);
  await waitFor(() => expect(view.queryAllByRole('alert')).toHaveLength(0));
  expect(request).toHaveBeenCalledTimes(16);
  expect(
    request.mock.calls
      .slice(8)
      .map(([method]) => method)
      .sort(),
  ).toEqual([...methods, 'reliability.summary'].sort());
  expect(view.getByTestId('performance-refresh').textContent).toBe('1');
});
