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
