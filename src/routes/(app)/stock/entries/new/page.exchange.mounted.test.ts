// @vitest-environment happy-dom
// Spec 142 — the new-entry form in canje mode: supplier, "Entregas" and
// "Recibes" sections, live value preview, and a shortage refusal that stays
// on the form with "Editar".
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { flushSync, type ComponentProps } from 'svelte';
import StockEntry from './PageBody.svelte';
import { page } from '../../../../../../tests/fixtures/pending-submission/page.svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$lib/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));
vi.mock(
  '$lib/components/crm/PartyPicker.svelte',
  async () => import('../../../../../../tests/fixtures/stock-item-picker/party.svelte'),
);
vi.mock(
  '$lib/components/stock/StockItemPicker.svelte',
  async () => import('../../../../../../tests/fixtures/stock-item-picker/picker.svelte'),
);

const data = {
  items: [
    { id: 'filler', code: 'FIL', name: 'HA Saypha Filler', uom: 'unit' },
    { id: 'volume', code: 'VOL', name: 'HA Saypha Volume', uom: 'unit' },
  ],
  warehouses: [{ id: 'wh', name: 'Main', isDefault: true }],
  bins: [{ itemId: 'filler', warehouseId: 'wh', qty: 13, rate: 250 }],
  purchases: [],
  fx: { currency: 'PEN', base: 'USD', quote: 'PEN', rate: 3.75 },
} as unknown as ComponentProps<typeof StockEntry>['data'];

const calls: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(() => {
  calls.length = 0;
  flushSync(() => {
    page.url = new URL('http://localhost/stock/entries/new?type=exchange');
    page.data.user.id = 'actor-a';
    page.data.activeOrgId = 'org-a';
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/submit'))
        return Response.json(
          {
            message: 'insufficient stock',
            code: 'negative_stock',
            details: { itemId: 'filler', item: 'HA Saypha Filler', onHand: 13, requested: 20 },
          },
          { status: 409 },
        );
      if (method === 'POST' || method === 'PATCH') return Response.json({ id: 'entry-1' });
      return Response.json([]);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pick(section: string, name: string) {
  const region = screen.getByRole('region', { name: section });
  await fireEvent.click(within(region).getByRole('button', { name: m.stock_exchange_add() }));
  await fireEvent.click(screen.getByRole('button', { name: `pick ${name}` }));
}

it('builds a canje in two sections with a live value preview and posts both sides', async () => {
  const view = render(StockEntry, { data });
  expect(view.getByText(m.stock_exchange_party())).toBeTruthy();
  await pick(m.stock_exchange_out(), 'HA Saypha Filler');
  await pick(m.stock_exchange_in(), 'HA Saypha Volume');
  const qtys = view.container.querySelectorAll<HTMLInputElement>('input[type="number"]');
  expect(qtys).toHaveLength(2);
  await fireEvent.input(qtys[0], { target: { value: '20' } });
  await fireEvent.input(qtys[1], { target: { value: '20' } });

  const status = view.getByRole('status');
  expect(status.textContent).toContain('5,000.00');
  expect(view.getAllByText(/250\.00/).length).toBeGreaterThanOrEqual(2);

  // No supplier yet: the form says why it can't register.
  expect(view.getByText(m.stock_exchange_party_required())).toBeTruthy();
  const register = view.getByRole('button', { name: m.stock_exchange_submit() });
  expect((register as HTMLButtonElement).disabled).toBe(true);

  // Save draft: no costs typed, no currency, one line per side.
  await fireEvent.click(view.getByRole('button', { name: m.stock_save_draft() }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
    type: 'exchange',
    partyId: null,
    note: null,
    lines: [
      { itemId: 'filler', qty: 20, rate: null, fromWarehouseId: 'wh', toWarehouseId: null },
      { itemId: 'volume', qty: 20, rate: null, fromWarehouseId: null, toWarehouseId: 'wh' },
    ],
  });
});

it('keeps an item from merging across sides and explains the both-sides rule', async () => {
  const view = render(StockEntry, { data });
  await pick(m.stock_exchange_out(), 'HA Saypha Filler');
  await pick(m.stock_exchange_in(), 'HA Saypha Filler');
  expect(view.container.querySelectorAll('input[type="number"]')).toHaveLength(2);
  expect(view.getByText(m.stock_exchange_item_both_sides())).toBeTruthy();
});

it('refuses a shortage on the form with the amounts and "Editar", and retries the same draft', async () => {
  const view = render(StockEntry, { data });
  await fireEvent.click(view.getByRole('button', { name: 'set party' }));
  await pick(m.stock_exchange_out(), 'HA Saypha Filler');
  await pick(m.stock_exchange_in(), 'HA Saypha Volume');
  const qtys = view.container.querySelectorAll<HTMLInputElement>('input[type="number"]');
  await fireEvent.input(qtys[0], { target: { value: '20' } });

  const register = view.getByRole('button', { name: m.stock_exchange_submit() });
  expect((register as HTMLButtonElement).disabled).toBe(false);
  await fireEvent.click(register);
  const alert = await view.findByRole('alert');
  expect(alert.textContent).toContain(
    m.stock_exchange_shortage_title({ item: 'HA Saypha Filler' }),
  );
  expect(alert.textContent).toContain(
    m.stock_exchange_shortage_detail({ onHand: '13', requested: '20' }),
  );

  await fireEvent.click(view.getByRole('button', { name: m.common_edit() }));
  expect(view.queryByRole('alert')).toBeNull();
  expect(document.activeElement).toBe(qtys[0]);

  await fireEvent.click(register);
  await view.findByRole('alert');
  // The retry updates the draft the first attempt created — never a second one.
  expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/stock/entries')).toHaveLength(
    1,
  );
  expect(calls.some((c) => c.method === 'PATCH' && c.url === '/api/stock/entries/entry-1')).toBe(
    true,
  );
});
