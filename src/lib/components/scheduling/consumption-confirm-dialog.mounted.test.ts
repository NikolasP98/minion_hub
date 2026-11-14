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

const confirmButton = (view: ReturnType<typeof render>) =>
  view.getByRole('button', { name: 'Mark completed' }) as HTMLButtonElement;

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
