// @vitest-environment happy-dom
/**
 * Spec 116 slice 1 (FR-013) — the complete dialog cannot be confirmed before
 * its consumption rows are on screen: confirm stays off while they load, and a
 * failed read is an error with a retry, never an empty "no defaults" list.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import ConsumptionConfirmDialog from './ConsumptionConfirmDialog.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const confirmButton = (view: {
  getByRole: (role: 'button', options: { name: string }) => HTMLElement;
}) => view.getByRole('button', { name: 'Mark completed' }) as HTMLButtonElement;

describe('ConsumptionConfirmDialog waits for its rows (spec 116 FR-013)', () => {
  it('confirm is disabled while the rows load and sends nothing', async () => {
    const accruals = deferred<Response>();
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push(url);
          return Response.json({ ok: true, stockWarning: null });
        }
        if (url.startsWith('/api/stock/accruals')) return accruals.promise;
        return Response.json([]);
      }),
    );
    const view = render(ConsumptionConfirmDialog, {
      bookingId: 'b1',
      onclose: () => {},
      oncompleted: () => {},
    });

    const button = confirmButton(view);
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(posts).toEqual([]);

    accruals.resolve(Response.json({ accruals: [] }));
    await waitFor(() => expect(confirmButton(view).disabled).toBe(false));
  });

  it('a failed read shows an error with Retry and keeps confirm disabled', async () => {
    let fail = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('/api/stock/accruals')) {
          if (fail) throw new TypeError('Failed to fetch');
          return Response.json({ accruals: [] });
        }
        return Response.json([]);
      }),
    );
    const view = render(ConsumptionConfirmDialog, {
      bookingId: 'b1',
      productId: 'p1',
      onclose: () => {},
      oncompleted: () => {},
    });

    const retry = await view.findByRole('button', { name: 'Retry' });
    expect(view.queryByText('No stock defaults for this service.')).toBeNull();
    expect(confirmButton(view).disabled).toBe(true);

    fail = false;
    await fireEvent.click(retry);
    await waitFor(() => expect(confirmButton(view).disabled).toBe(false));
    expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

// ── spec 126 recover_stock ───────────────────────────────────────────────────
describe('ConsumptionConfirmDialog mode="recover_stock" (spec 126)', () => {
  const FP = 'f'.repeat(64);
  const member = (bookingId: string, over: Record<string, unknown> = {}) => ({
    bookingId,
    status: 'completed',
    openCount: 0,
    realizedCount: 0,
    releasedCount: 0,
    sourceEntry: null,
    eligibility: 'not_needed',
    confirmation: null,
    ...over,
  });
  const saved = member('m-b', {
    eligibility: 'retry_saved',
    sourceEntry: { id: 'entry-12345678', status: 'draft' },
  });
  const open = member('m-a', {
    eligibility: 'confirm_open',
    openCount: 1,
    confirmation: {
      state: 'available',
      value: {
        openCount: 1,
        expectedOpenFingerprint: FP,
        rows: [
          {
            accrualId: 'acc1',
            itemId: 'item1',
            itemName: 'Serum',
            uom: 'bottle',
            consumptionUom: 'ml',
            unitsPerStockUom: 50,
            subunitsPerStockUom: null,
            diagramEnabled: false,
            qty: 0.2,
            qtyConsumption: 10,
          },
        ],
      },
    },
  });
  const manual = member('m-c', { eligibility: 'manual_review' });
  const done = member('m-d', { realizedCount: 1 });

  function stub(
    stockRecovery: unknown,
    post: (url: string) => Response | Promise<Response> = () =>
      Response.json({ ok: true, stockWarning: null }),
  ) {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === 'POST') return post(url);
        if (url === '/api/pos/appointments/m-a')
          return Response.json({
            stockRecovery,
            eventType: null,
            visit: {
              members: [
                { id: 'm-a', eventTypeTitle: 'Botox' },
                { id: 'm-b', eventTypeTitle: 'Peeling' },
              ],
            },
          });
        return new Response(null, { status: 404 });
      }),
    );
    return calls;
  }
  const mount = (over: Record<string, unknown> = {}) =>
    render(ConsumptionConfirmDialog, {
      bookingId: 'm-a',
      mode: 'recover_stock',
      apiBase: '/api/pos/appointments',
      onclose: () => {},
      ...over,
    });
  const available = (...value: unknown[]) => ({ state: 'available', value });

  it('reads only the persisted facts (no defaults, no accrual list) and shows each member apart', async () => {
    const calls = stub(available(saved, open, manual, done));
    const view = mount();
    await view.findByText('Botox');
    expect(calls.map((c) => c.url)).toEqual(['/api/pos/appointments/m-a']);
    const text = view.container.textContent!;
    expect(text).toContain('Peeling');
    expect(text).toContain('saved stock movement (draft)');
    expect(text).toContain('Serum');
    expect(text).toContain('Needs a manual review');
  });

  it('retries sequentially in id order: reviewed lines + precondition for the open set, {} for the saved entry', async () => {
    const calls = stub(available(saved, open, manual, done));
    const recovered = vi.fn();
    const view = mount({ onrecovered: recovered });
    await view.findByText('Peeling'); // loaded: the action is enabled only after the facts are read
    await fireEvent.click(view.getByRole('button', { name: 'Retry stock posting' }));
    await waitFor(() => expect(recovered).toHaveBeenCalled());
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => c.url)).toEqual([
      '/api/pos/appointments/m-a/complete',
      '/api/pos/appointments/m-b/complete',
    ]);
    expect(posts[0]!.body).toEqual({
      lines: [{ itemId: 'item1', qty: 0.2, qtyConsumption: 10 }],
      recovery: { mode: 'confirm_open', expectedOpenCount: 1, expectedOpenFingerprint: FP },
    });
    expect(posts[1]!.body).toEqual({});
    expect(calls.some((c) => c.method === 'PATCH' || c.url.includes('/status'))).toBe(false);
    expect(recovered).toHaveBeenCalledWith({ 'm-a': 'resolved', 'm-b': 'resolved' });
  });

  it('a confirmed zero sends explicit empty lines with the precondition', async () => {
    const calls = stub(available(open));
    const view = mount();
    const qty = (await view.findByLabelText('Serum')) as HTMLInputElement;
    await fireEvent.input(qty, { target: { value: '0' } });
    await fireEvent.click(view.getByRole('button', { name: 'Retry stock posting' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      lines: [],
      recovery: { expectedOpenCount: 1 },
    });
  });

  it('a stale 409 stops the rest, says so, and reloads the facts', async () => {
    const calls = stub(available(saved, open), () =>
      Response.json({ error: 'recovery_preview_stale' }, { status: 409 }),
    );
    const view = mount();
    await view.findByText('Peeling'); // loaded: the action is enabled only after the facts are read
    await fireEvent.click(view.getByRole('button', { name: 'Retry stock posting' }));
    await view.findByText(/changed after you reviewed it/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(
      calls.filter((c) => c.url === '/api/pos/appointments/m-a' && c.method === 'GET'),
    ).toHaveLength(2);
  });

  it('a lost response is unknown and stops the rest; a warning is not posted but continues', async () => {
    let n = 0;
    const calls = stub(available(saved, open), () => {
      n++;
      if (n === 1)
        return Response.json({
          ok: true,
          stockWarning: { code: 'negative_stock', message: 'short bin' },
        });
      throw new TypeError('Failed to fetch');
    });
    const view = mount();
    await view.findByText('Peeling'); // loaded: the action is enabled only after the facts are read
    await fireEvent.click(view.getByRole('button', { name: 'Retry stock posting' }));
    await view.findByText(/Not posted yet: short bin/);
    await view.findByText(/Unknown outcome/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it.each([
    ['denied', { state: 'denied' }, 'cannot recover stock'],
    ['unavailable', { state: 'unavailable', reason: 'read_failed' }, 'could not be loaded'],
    ['malformed', available({ bookingId: 'm-a' }), 'could not be loaded'],
    [
      'an eligible member without its open set',
      available({ ...open, confirmation: null }),
      'could not be loaded',
    ],
    ['empty', { state: 'empty' }, 'Nothing to recover'],
  ])('%s sends nothing and keeps the action off', async (_n, facet, text) => {
    const calls = stub(facet);
    const view = mount();
    await view.findByText(new RegExp(text));
    expect(
      (view.getByRole('button', { name: 'Retry stock posting' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});
