// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { formatMoney } from '$lib/utils/format';

const context = vi.hoisted(() => ({
  page: {
    url: new URL('http://localhost/pos/sell'),
    data: {
      posSettings: {
        methods: [
          { id: 'cash', label: 'Cash', enabled: true, takesTendered: true },
          { id: 'card', label: 'Card', enabled: true, takesTendered: false },
        ],
      },
      openShift: {
        shift: { id: 'shift-1', openedAt: new Date().toISOString(), openingFloat: { cash: 10 } },
        summary: { ticketCount: 1, voidCount: 0, gross: 50, byMethod: { cash: 20, card: 30 } },
      },
      openerName: 'Cashier',
      openShifts: [],
    } as Record<string, unknown>,
  },
  invalidate: vi.fn(async () => {}),
}));
vi.mock('$app/state', () => ({ page: context.page }));
vi.mock('$app/navigation', () => ({ invalidate: context.invalidate }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));
vi.mock('$lib/state/ui/toast.svelte', () => ({
  toastAsync: <T>(operation: Promise<T>) => operation,
}));

import ShiftBanner from './ShiftBanner.svelte';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const current = (cash: number, card: number, unemitted = 0) =>
  response({
    shift: { id: 'shift-1', openedAt: new Date().toISOString(), openingFloat: { cash: 10 } },
    summary: {
      ticketCount: 1,
      voidCount: 0,
      gross: cash + card,
      byMethod: { cash, card },
      unemitted,
    },
  });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openClose() {
  await fireEvent.click(screen.getAllByRole('button', { name: m.pos_shift_close_cta() })[0]);
  return within(await screen.findByRole('dialog'));
}

const flat = (text: string) => text.replace(/\s+/g, ' ');
const money = (amount: number) => flat(formatMoney(amount));
const closeText = () => flat(document.querySelector('dialog[data-size="lg"]')?.textContent ?? '');

const confirmButton = (dialog: ReturnType<typeof within>) =>
  dialog.getByRole('button', { name: m.pos_shift_close_cta() }) as HTMLButtonElement;

describe('mounted shift close dialog', () => {
  it('keeps confirm off until fresh totals arrive and ignores an answer from an earlier opening', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(ShiftBanner);

    let dialog = await openClose();
    expect(confirmButton(dialog).disabled).toBe(true);
    // Dismiss and reopen while the first answer is still in flight.
    await fireEvent.click(dialog.getByRole('button', { name: m.common_close() }));
    dialog = await openClose();
    second.resolve(current(20, 30));
    await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));
    expect(closeText()).toContain(money(30)); // cash: float 10 + 20
    first.resolve(current(999, 999, 7));
    await new Promise((done) => setTimeout(done, 0));
    expect(closeText()).not.toContain(money(1009));
    expect(view.queryByText(m.pos_shift_close_emit({ count: '7' }))).toBeNull();
  });

  it('tells a failed load apart from a closed shift and retries it', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ error: 'boom' }, 500))
      .mockResolvedValueOnce(current(20, 30));
    const view = render(ShiftBanner);
    const dialog = await openClose();

    await waitFor(() =>
      expect(dialog.getByRole('alert').textContent).toContain(m.pos_shift_totals_failed()),
    );
    expect(confirmButton(dialog).disabled).toBe(true);
    expect(context.invalidate).not.toHaveBeenCalled();

    await fireEvent.click(dialog.getByRole('button', { name: m.common_retry() }));
    await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));
    expect(dialog.queryByRole('alert')).toBeNull();
  });

  it('closes the dialog and resyncs when the shift was already closed elsewhere', async () => {
    fetchMock.mockResolvedValueOnce(response({ shift: null }));
    const view = render(ShiftBanner);
    await fireEvent.click(view.getAllByRole('button', { name: m.pos_shift_close_cta() })[0]);
    await waitFor(() => expect(context.invalidate).toHaveBeenCalledWith('pos:shift'));
    // The dialog is asked to close (its exit animation never runs in happy-dom).
    expect(document.querySelector('dialog[data-size="lg"]')?.hasAttribute('data-closing')).toBe(
      true,
    );
  });

  it('sends one close for a double confirm and only the counted methods', async () => {
    const post = deferred<Response>();
    fetchMock.mockResolvedValueOnce(current(20, 30)).mockReturnValueOnce(post.promise);
    const view = render(ShiftBanner);
    const dialog = await openClose();
    await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));

    await fireEvent.click(confirmButton(dialog));
    await fireEvent.click(confirmButton(dialog));
    post.resolve(response({ ok: true, shift: { emission: null } }));
    await waitFor(() => expect(context.invalidate).toHaveBeenCalledWith('pos:shift'));

    const closes = fetchMock.mock.calls.filter(([url]) => url === '/api/pos/shifts/close');
    expect(closes).toHaveLength(1);
    expect(JSON.parse(String(closes[0][1]?.body))).toEqual({ counted: { cash: 0 }, note: null });
  });
});
