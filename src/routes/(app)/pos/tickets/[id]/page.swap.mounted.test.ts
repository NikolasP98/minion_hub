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
  },
  lines: [line('l1', 'product', 'faja-m', 'Faja M'), line('l2', 'service', 'botox', 'Botox')],
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
  init?.method === 'POST' ? swap() : Response.json({ sellables }),
);

beforeEach(() => {
  swap = () => Response.json({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const openSwap = async () => {
  const view = render(Ticket, { data });
  // Only the product line offers the swap; the treatment line does not.
  const buttons = view.getAllByRole('button', { name: m.pos_swap_action() });
  expect(buttons).toHaveLength(1);
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
