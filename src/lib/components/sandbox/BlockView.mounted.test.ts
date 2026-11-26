// @vitest-environment happy-dom
/**
 * Spec 049 D7 — a block renders natively from its spec: the KPI reads its
 * number from the `value` alias, shows the delta versus the compare query
 * with a status chip, and a refused query becomes the shared error state
 * with the server's own message (never a blank box).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import BlockView from './BlockView.svelte';
import Fixture from './BlockView.fixture.svelte';
import { flushSync } from 'svelte';
import { parseBlockSpec } from '$lib/sandbox/blocks/schema';

afterEach(cleanup);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const kpi = parseBlockSpec({
  v: 1,
  type: 'kpi',
  source: {
    dataset: 'pos.tickets',
    metric: { fn: 'sum', col: 'total' },
    period: { col: 'submitted_at', range: 'last_30d' },
  },
  format: 'money',
  compare: true,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('BlockView (kpi)', () => {
  it('shows the formatted value and the delta versus the previous period', async () => {
    // The value query is issued first, the compare query second.
    fetchMock.mockImplementation(async () => {
      const current = fetchMock.mock.calls.length === 1;
      return jsonResponse({
        columns: [{ name: 'value', type: 'number' }],
        rows: [{ value: current ? '1500' : 1000 }],
      });
    });
    const view = render(BlockView, { spec: kpi, title: 'Sales' });
    await waitFor(() => expect(view.container.textContent).toContain('S/'));
    expect(view.container.textContent).toMatch(/1[,.]500/);
    expect(view.container.textContent).toMatch(/\+50\s?%/);
    expect(view.container.querySelector('[data-block-kind="kpi"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) expect(call[0]).toBe('/api/sandbox/query');
  });

  it('renders the server’s refusal text in the shared error state', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Your role does not permit 'view' on pos.", field: 'dataset' }, 403),
    );
    const view = render(BlockView, { spec: kpi, title: 'Sales' });
    await waitFor(() =>
      expect(view.container.textContent).toContain("Your role does not permit 'view' on pos."),
    );
    expect(view.container.textContent).not.toContain('S/');
  });
});

describe('BlockView page connections (spec 150)', () => {
  const plain = parseBlockSpec({
    v: 1,
    type: 'kpi',
    source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
  });
  const connected = parseBlockSpec({
    v: 1,
    type: 'kpi',
    source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
    listens: [{ var: 'period', col: 'submitted_at' }],
  });
  const ok = () =>
    jsonResponse({ columns: [{ name: 'value', type: 'number' }], rows: [{ value: 3 }] });
  const date = (range: string) => [
    { col: 'submitted_at', value: { kind: 'date' as const, range: range as never } },
  ];

  it('reloads once per new binding key and not at all when the key is unchanged', async () => {
    fetchMock.mockImplementation(async () => ok());
    const view = render(Fixture, {
      initial: { spec: connected, title: 'T', bindings: date('today'), bindingKey: 'a' },
    });
    const set = (props: Record<string, unknown>) => {
      (view.component as unknown as { set: (p: unknown) => void }).set(props);
      flushSync();
    };
    await waitFor(() => expect(view.container.textContent).toContain('3'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).where).toHaveLength(2);

    // Same key, new array identity: no request.
    set({ spec: connected, title: 'T', bindings: date('today'), bindingKey: 'a' });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    set({ spec: connected, title: 'T', bindings: date('last_7d'), bindingKey: 'b' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('aborts the request a newer key overtook and shows only the latest result', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      const n = signals.length;
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        if (n === 2) resolve(jsonResponse({ columns: [], rows: [{ value: 7 }] }));
      });
    });
    const view = render(Fixture, { initial: { spec: connected, title: 'T', bindingKey: 'a' } });
    await waitFor(() => expect(signals).toHaveLength(1));
    (view.component as unknown as { set: (p: unknown) => void }).set({
      spec: connected,
      title: 'T',
      bindingKey: 'b',
    });
    flushSync();
    await waitFor(() => expect(view.container.textContent).toContain('7'));
    expect(signals[0].aborted).toBe(true);
    expect(view.container.textContent).not.toContain('aborted');
  });

  it('fails closed with zero requests when the wiring is unavailable and the block is connected', async () => {
    const view = render(BlockView, { spec: connected, title: 'T', wiringAvailable: false });
    await waitFor(() =>
      expect(view.container.textContent).toContain('page connections could not be read'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still loads an unconnected block when the wiring is unavailable', async () => {
    fetchMock.mockImplementation(async () => ok());
    const view = render(BlockView, { spec: plain, title: 'T', wiringAvailable: false });
    await waitFor(() => expect(view.container.textContent).toContain('3'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
