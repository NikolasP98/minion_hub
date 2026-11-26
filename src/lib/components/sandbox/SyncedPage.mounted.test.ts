// @vitest-environment happy-dom
/**
 * Spec 150 SC-001: one filter change reloads exactly the blocks connected to it
 * (6 blocks, 3 connected -> 3 requests), once, after the 250 ms settle; the
 * filter bar is operable by keyboard alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SyncedPage from './SyncedPage.svelte';
import { createSandboxHost, type SandboxElementRecord } from '$lib/sandbox/host.svelte';
import { pageWiring } from '$server/sandbox/wiring';
import { DATASETS } from '$server/sandbox/datasets';
import type { BlockSpec } from '$lib/sandbox/blocks/schema';

afterEach(cleanup);

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const row = (
  id: string,
  position: number,
  spec: Record<string, unknown>,
  title = id,
): SandboxElementRecord => ({
  id,
  page: 'default',
  title,
  html: '',
  css: '',
  js: '',
  spec: spec as unknown as BlockSpec,
  w: 1,
  h: 1,
  position,
  createdBy: 'p1',
  updatedAt: '2026-11-25T00:00:00.000Z',
  published: false,
  mine: true,
});

const kpi = (listens?: Array<{ var: string; col: string }>) => ({
  v: 1,
  type: 'kpi',
  source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
  format: 'number',
  tone: 'accent',
  ...(listens ? { listens } : {}),
});
const wired = [{ var: 'period', col: 'submitted_at' }];

const elements = [
  row('filter-1', 0, { v: 1, type: 'filter', var: 'period', control: 'date_range' }, 'Period'),
  row('b1', 1, kpi(wired)),
  row('b2', 2, kpi()),
  row('b3', 3, kpi(wired)),
  row('b4', 4, kpi()),
  row('b5', 5, kpi(wired)),
  row('b6', 6, kpi()),
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ columns: [{ name: 'value', type: 'number' }], rows: [{ value: 1 }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

const queries = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string));

describe('SyncedPage', () => {
  it('a filter change reloads exactly the 3 connected blocks, once, after the settle (SC-001)', async () => {
    const host = createSandboxHost(elements, undefined, pageWiring(elements, DATASETS));
    render(SyncedPage, { props: { host, onadd: () => {} } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    expect(queries().every((q) => !q.where)).toBe(true);
    fetchMock.mockClear();

    // Keyboard path: focus the trigger, open with ArrowDown, move to "Last 30 days", Enter.
    const trigger = screen.getByRole('button', { name: /Period/ });
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByRole('menuitem', { name: 'Last 30 days' });
    option.focus();
    await fireEvent.keyDown(option, { key: 'Enter' });

    // Nothing reloads inside the settle window...
    expect(fetchMock).not.toHaveBeenCalled();
    // ...then exactly the 3 connected blocks do, each once, with the date window on their column.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const q of queries()) {
      expect(q.where.map((w: { col: string; op: string }) => `${w.col} ${w.op}`)).toEqual([
        'submitted_at gte',
        'submitted_at lt',
      ]);
    }
  });

  it('keeps filters out of the grid and shows them in a labelled bar', async () => {
    const host = createSandboxHost(elements, undefined, pageWiring(elements, DATASETS));
    const view = render(SyncedPage, { props: { host, onadd: () => {} } });
    expect(screen.getByRole('region', { name: 'Page filters' })).toBeTruthy();
    expect(view.container.querySelectorAll('[data-grid-id]')).toHaveLength(6);
    expect(view.container.querySelector('[data-grid-id="filter-1"]')).toBeNull();
  });

  it('fails closed when the wiring report is unavailable: connected blocks make no request', async () => {
    const host = createSandboxHost(elements, undefined, null);
    render(SyncedPage, { props: { host, onadd: () => {} } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(queries().every((q) => !q.where)).toBe(true);
  });
});
