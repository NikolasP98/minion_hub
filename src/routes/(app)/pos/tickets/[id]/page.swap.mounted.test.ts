// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import Ticket from './PageBody.svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
const ORG = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/home'),
    params: {},
    route: { id: '/(app)/home' },
    state: {},
    data: {
      user: { id: 'actor-a', supabaseId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b' },
      activeOrgId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',
      personalAgent: { agent: { agentId: 'agent-a' } },
      permissions: { permissions: [] },
    },
  },
}));
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
    line('11111111-1111-4111-8111-111111111111', 'product', 'faja-m', 'Faja M'),
    line('11111112-1111-4111-8111-111111111112', 'service', 'botox', 'Botox'),
    // A product charged from a visit's tray: linked to the appointment, still swappable.
    {
      ...line('11111113-1111-4111-8111-111111111113', 'product', 'faja-xl', 'Faja XL'),
      bookingId: 'b1',
    },
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
  { productId: 'botox', name: 'Botox', kind: 'service', unitPrice: 120 },
];
const L1 = '11111111-1111-4111-8111-111111111111';
const PREVIEW = {
  schemaVersion: 1,
  eligible: true,
  blockers: [],
  previewHash: 'a'.repeat(64),
  payloadHash: 'b'.repeat(64),
  quantityEffects: [{ itemId: 'i1', before: '-1', after: '0' }],
  cost: null,
};
let swap: (body: Record<string, unknown>) => Response;
let preview: () => Response;
const defaultFetch = async (url: string, init?: RequestInit) =>
  init?.method !== 'POST'
    ? String(url).startsWith('/api/stock/corrections')
      ? Response.json({ outcome: 'not_found' })
      : Response.json({ sellables })
    : url.endsWith('/void')
      ? Response.json({ ok: true })
      : url.endsWith('/swap/preview')
        ? preview()
        : swap(JSON.parse(String(init.body)));
const fetchMock = vi.fn(defaultFetch);

const applied = (body: Record<string, unknown>) =>
  Response.json({
    ok: true,
    schemaVersion: 1,
    outcome: 'applied',
    replayed: false,
    receipt: { operationKey: body.operationKey, sourceId: L1 },
  });
const refused = (code: string, status = 409) =>
  Response.json({ code, error: 'x', outcome: 'not_applied' }, { status });

beforeEach(() => {
  swap = applied;
  preview = () => Response.json(PREVIEW);
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  localStorage.clear();
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Reason -> review -> confirm: the only way a swap is sent. */
const confirmSwap = async (view: ReturnType<typeof render>, reason = 'wrong size') => {
  await fireEvent.input(view.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: reason },
  });
  await fireEvent.click(view.getByRole('button', { name: m.stock_corr_preview() }));
  await waitFor(() => view.getByRole('button', { name: m.stock_corr_confirm() }));
  await fireEvent.click(view.getByRole('button', { name: m.stock_corr_confirm() }));
};

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
  await confirmSwap(view);
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith('pos:ticket'));
  const [url, init] = fetchMock.mock.calls.find(
    ([u, i]) => i?.method === 'POST' && !String(u).endsWith('/preview'),
  )!;
  expect(url).toBe('/api/pos/tickets/t1/lines/11111111-1111-4111-8111-111111111111/swap');
  expect(JSON.parse(String(init!.body))).toEqual({
    productId: 'faja-l',
    expectedProductId: 'faja-m',
    reason: 'wrong size',
    operationKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    previewHash: 'a'.repeat(64),
    payloadHash: 'b'.repeat(64),
  });
  // The answer was authoritative: the recovery pointer is gone.
  expect(Object.keys(localStorage).filter((k) => k.startsWith('minion:stock-correction'))).toEqual(
    [],
  );
});

it('a refusal says what to do instead', async () => {
  swap = () => refused('stock_drift');
  const view = await openSwap();
  await confirmSwap(view);
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.pos_swap_err_rering()));
  expect(invalidate).not.toHaveBeenCalled();
});

it('a sale that changed underneath reloads and reopens on the current line', async () => {
  swap = () => refused('line_changed');
  const view = await openSwap();
  await confirmSwap(view);
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.pos_swap_err_changed()));
  expect(invalidate).toHaveBeenCalledWith('pos:ticket');
  // The choices were loaded again for the reloaded line.
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/pos/sellables')).toHaveLength(2);
});

it('when a swap is not enough, voids the sale and opens the till at the charged prices', async () => {
  swap = () => refused('price_differs');
  const view = await openSwap();
  await confirmSwap(view);
  // Step 1: the refusal offers the correction. Step 2: explain, pick the refund, confirm.
  await waitFor(() => view.getByRole('button', { name: m.pos_rering_action() }));
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() => expect(view.getByText(m.pos_rering_explain())).toBeTruthy());
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/void'))).toBe(false);
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() => expect(goto).toHaveBeenCalledWith('/pos/sell'));

  const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/void'))!;
  expect(JSON.parse(String(init!.body))).toEqual({ refund: 'cash' });
  const staged = JSON.parse(localStorage.getItem(`pos-charge:actor-a:${ORG}`)!);
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
    {
      bookingId: 'b1',
      productId: 'faja-xl',
      title: 'Faja XL',
      kind: 'product',
      qty: 1,
      unitPrice: 120,
      discount: 0,
    },
  ]);
  expect(staged.partyId).toBe('party-1');
});

const voided = () => fetchMock.mock.calls.some(([url]) => String(url).endsWith('/void'));

it('a product of another price: the till opens with it at its catalogue price', async () => {
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_other_price() }));
  await fireEvent.change(view.getByLabelText(m.pos_rering_to()), { target: { value: 'faja-xl' } });
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() => expect(goto).toHaveBeenCalledWith('/pos/sell'));
  const staged = JSON.parse(localStorage.getItem(`pos-charge:actor-a:${ORG}`)!);
  expect(staged.lines[0]).toEqual({
    bookingId: null,
    productId: 'faja-xl',
    title: 'Faja XL',
    kind: 'product',
    qty: 1,
    discount: 0,
  });
});

it('a sale with a package session or an instalment is not voided for the user', async () => {
  swap = () => refused('price_differs');
  const withSession = {
    ...data,
    lines: [
      ...data.lines,
      {
        ...line('11111114-1111-4111-8111-111111111114', 'service', 'botox', 'Sesión'),
        redemptionId: 'r1',
      },
    ],
  } as typeof data;
  const view = render(Ticket, { data: withSession });
  await fireEvent.click(view.getAllByRole('button', { name: m.pos_swap_action() })[0]);
  await waitFor(() => expect(view.getByText(m.pos_swap_note())).toBeTruthy());
  expect(view.queryByRole('button', { name: m.pos_rering_other_price() })).toBeNull();
  await confirmSwap(view);
  await waitFor(() => expect(view.getByText(m.pos_rering_manual())).toBeTruthy());
  expect(view.queryByRole('button', { name: m.pos_rering_action() })).toBeNull();
});

it('refuses BEFORE the void when an item can no longer be put in the till', async () => {
  const retired = {
    ...data,
    lines: [
      ...data.lines,
      line('11111115-1111-4111-8111-111111111115', 'service', 'peeling', 'Peeling'),
    ],
  } as typeof data;
  const view = render(Ticket, { data: retired });
  await fireEvent.click(view.getAllByRole('button', { name: m.pos_swap_action() })[0]);
  await waitFor(() => view.getByRole('button', { name: m.pos_rering_other_price() }));
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_other_price() }));
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() =>
    expect(view.getByRole('alert').textContent).toBe(
      m.pos_rering_err_inactive({ items: 'Peeling' }),
    ),
  );
  expect(voided()).toBe(false);
});

it('a void refusal names its own next step', async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    init?.method !== 'POST'
      ? Response.json({ sellables })
      : Response.json({ code: 'no_party', error: 'x' }, { status: 409 }),
  );
  const view = await openSwap();
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_other_price() }));
  await fireEvent.click(view.getByRole('button', { name: m.pos_rering_action() }));
  await waitFor(() =>
    expect(view.getByRole('alert').textContent).toBe(m.pos_rering_err_no_party()),
  );
  expect(goto).not.toHaveBeenCalled();
});

const applies = () =>
  fetchMock.mock.calls.filter(
    ([u, i]) =>
      i?.method === 'POST' && String(u).endsWith('/swap') && !String(u).endsWith('/preview'),
  );
const pointers = () =>
  Object.keys(localStorage).filter((k) => k.startsWith('minion:stock-correction'));

it('a typed refusal clears the pointer and the user must review again before another try', async () => {
  swap = () => refused('negative_stock');
  const view = await openSwap();
  await confirmSwap(view);
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.pos_swap_err_no_stock()));
  expect(pointers()).toEqual([]);
  expect(view.queryByRole('button', { name: m.stock_corr_confirm() })).toBeNull();
});

it('a lost answer keeps the pointer, asks the server and never writes twice', async () => {
  swap = () => {
    throw new TypeError('network down');
  };
  const view = await openSwap();
  await confirmSwap(view);
  await waitFor(() => view.getByText(m.stock_corr_pending_title()));
  expect(pointers()).toHaveLength(1);
  // The status lookup is the only follow-up; the key stays blocked while unknown.
  await waitFor(() => view.getByRole('button', { name: m.stock_corr_copy_ref() }));
  expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/stock/corrections?'))).toBe(
    true,
  );
  expect(applies()).toHaveLength(1);
  expect(view.queryByRole('button', { name: m.stock_corr_confirm() })).toBeNull();
  await fireEvent.click(view.getByRole('button', { name: m.stock_corr_check() }));
  expect(applies()).toHaveLength(1);
  expect(pointers()).toHaveLength(1);
});

it('after a reload the same pointer restores the committed outcome without a new write', async () => {
  swap = () => {
    throw new TypeError('network down');
  };
  const first = await openSwap();
  await confirmSwap(first);
  await waitFor(() => first.getByText(m.stock_corr_pending_title()));
  const key = pointers()[0]!;
  cleanup();
  // The server did commit: the status lookup now answers applied.
  const operationKey = key.split(':').at(-2)!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    String(url).startsWith('/api/stock/corrections?')
      ? Response.json({ outcome: 'applied', receipt: { operationKey, sourceId: L1 } })
      : defaultFetch(url, init),
  );
  const view = render(Ticket, { data });
  await fireEvent.click(view.getAllByRole('button', { name: m.pos_swap_action() })[0]);
  await waitFor(() => view.getByText(m.stock_corr_applied_check()));
  expect(applies()).toHaveLength(1);
  expect(invalidate).toHaveBeenCalledWith('pos:ticket');
  await fireEvent.click(view.getByRole('button', { name: m.common_dismiss() }));
  expect(pointers()).toEqual([]);
});

it('an unusable storage blocks the confirmation before any write', async () => {
  const view = await openSwap();
  // Readable but full: the pointer cannot be saved, so nothing may be sent.
  vi.stubGlobal('localStorage', {
    length: 0,
    key: () => null,
    getItem: () => null,
    clear: () => {},
    removeItem: () => {},
    setItem: () => {
      throw new DOMException('quota', 'QuotaExceededError');
    },
  });
  await confirmSwap(view);
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe(m.stock_corr_storage()));
  expect(applies()).toHaveLength(0);
});

it('editing the reason after the review disables the confirmation until reviewed again', async () => {
  const view = await openSwap();
  await fireEvent.input(view.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: 'a' },
  });
  await fireEvent.click(view.getByRole('button', { name: m.stock_corr_preview() }));
  await waitFor(() => view.getByRole('button', { name: m.stock_corr_confirm() }));
  await fireEvent.input(view.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: 'b' },
  });
  expect(
    (view.getByRole('button', { name: m.stock_corr_confirm() }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(view.getByText(m.stock_corr_stale())).toBeTruthy();
});

it('a preview blocker explains itself and cannot be confirmed', async () => {
  preview = () => Response.json({ ...PREVIEW, eligible: false, blockers: ['period_locked'] });
  const view = await openSwap();
  await fireEvent.input(view.getByLabelText(new RegExp(m.stock_corr_reason_label())), {
    target: { value: 'r' },
  });
  await fireEvent.click(view.getByRole('button', { name: m.stock_corr_preview() }));
  await waitFor(() => view.getByText(m.pos_swap_err_period()));
  expect(
    (view.getByRole('button', { name: m.stock_corr_confirm() }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
