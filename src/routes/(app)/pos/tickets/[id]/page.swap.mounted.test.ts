// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import Ticket from './PageBody.svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../../tests/fixtures/pending-submission/page.svelte'),
);
const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ invalidate, goto: vi.fn(), afterNavigate: vi.fn() }));
const goto = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$lib/navigation', async (original) => ({
  ...(await original<typeof import('$lib/navigation')>()),
  goto,
}));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

const line = (id: string, kind: string, finProductId: string, description: string) => ({
  id,
  kind,
  finProductId,
  description,
  qty: '1',
  unitPrice: '120.00',
  discount: '0',
  total: '120.00',
  bookingId: null,
});
const data = {
  ticket: {
    id: 't1',
    humanId: 'POS-1',
    status: 'submitted',
    currency: 'PEN',
    submittedAt: new Date('2026-11-14T15:00:00Z'),
    stockEntryId: 'entry-1',
    stockWarning: null,
    invoiceProviderRef: null,
    subtotal: '240.00',
    discountTotal: '0',
    taxTotal: '0',
    total: '240.00',
    note: null,
    partyId: 'party-1',
    customerName: 'Client',
  },
  lines: [
    line('l1', 'product', 'faja-m', 'Faja M'),
    line('l2', 'service', 'botox', 'Botox'),
    // A product charged from a visit's tray: linked to the appointment, still swappable.
    { ...line('l3', 'product', 'faja-xl', 'Faja XL'), bookingId: 'b1' },
  ],
  payments: [],
  emissions: [],
  methods: [],
  shiftStatus: 'open',
  periodLocked: false,
  emissionMode: 'off',
  createdByName: null,
  invoiceId: null,
} as unknown as ComponentProps<typeof Ticket>['data'];

const sellables = [
  { productId: 'faja-m', name: 'Faja M', kind: 'product', unitPrice: 120 },
  { productId: 'faja-l', name: 'Faja L', kind: 'product', unitPrice: 120 },
  { productId: 'faja-xl', name: 'Faja XL', kind: 'product', unitPrice: 150 },
];
let swap: () => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
  init?.method !== 'POST'
    ? Response.json({ sellables })
    : url.endsWith('/void')
      ? Response.json({ ok: true })
      : swap(),
);

beforeEach(() => {
  swap = () => Response.json({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const openSwap = async () => {
  const view = render(Ticket, { data });
  // Product lines offer the swap, linked to a visit or not; the treatment does not.
  const buttons = view.getAllByRole('button', { name: m.pos_swap_action() });
  expect(buttons).toHaveLength(2);
  await fireEvent.click(buttons[0]);
  await waitFor(() => expect(view.getByText(m.pos_swap_note())).toBeTruthy());
  return view;
};

it('links the sale to its stock movement', () => {
  const view = render(Ticket, { data });
  expect(view.getByText(m.pos_ticket_stock_link()).getAttribute('href')).toBe(
    '/stock/entries/entry-1',
  );
});

it('swaps a product line for the same-price product and reloads the sale', async () => {
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_swap_save() }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith('pos:ticket'));
  const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
  expect(url).toBe('/api/pos/tickets/t1/lines/l1/swap');
  expect(JSON.parse(String(init!.body))).toEqual({
    productId: 'faja-l',
    expectedProductId: 'faja-m',
  });
});

it('a refusal says what to do instead', async () => {
  swap = () => Response.json({ code: 'stock_drift', error: 'x' }, { status: 409 });
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_swap_save() }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.pos_swap_err_rering()));
  expect(invalidate).not.toHaveBeenCalled();
});

it('a sale that changed underneath reloads and reopens on the current line', async () => {
  swap = () => Response.json({ code: 'line_changed', error: 'x' }, { status: 409 });
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_swap_save() }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.pos_swap_err_changed()));
  expect(invalidate).toHaveBeenCalledWith('pos:ticket');
  // The choices were loaded again for the reloaded line.
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/pos/sellables')).toHaveLength(2);
});

it('when a swap is not enough, voids the sale and opens the till at the charged prices', async () => {
  swap = () => Response.json({ code: 'price_differs', error: 'x' }, { status: 409 });
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_swap_save() }));
  // Step 1: the refusal offers the correction. Step 2: explain, pick the refund, confirm.
  await waitFor(() => view.getByRole('button', { name: m.pos_rering_action() }));
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() => expect(view.getByText(m.pos_rering_explain())).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/void'))).toBe(false);
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() => expect(goto).toHaveBeenCalledWith('/pos/sell'));

  const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/void'))!;
  expect(JSON.parse(String(init!.body))).toEqual({ refund: 'cash' });
  const staged = JSON.parse(localStorage.getItem('pos-charge:actor-a:org-a')!);
  expect(staged.lines).toEqual([
    {
      bookingId: null,
      productId: 'faja-m',
      title: 'Faja M',
      kind: 'product',
      qty: 1,
      unitPrice: 120,
      discount: 0,
    },
    {
      bookingId: null,
      productId: 'botox',
      title: 'Botox',
      kind: 'service',
      qty: 1,
      unitPrice: 120,
      discount: 0,
    },
  ]);
  expect(staged.partyId).toBe('party-1');
});
