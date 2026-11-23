// @vitest-environment happy-dom
// Spec 144 — a receipt line whose unit cost is far from the item's average
// warns under the line; "Es el total" turns the typed amount into the line
// total. The warning never blocks registering.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync, type ComponentProps } from 'svelte';
import StockEntry from './PageBody.svelte';
import { page } from '../../../../../../tests/fixtures/pending-submission/page.svelte';
import * as m from '$lib/paraglide/messages';
import { formatMoney } from '$lib/utils/format';

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
  items: [{ id: 'plus', code: 'VP', name: 'HA Saypha Volume Plus', uom: 'unit' }],
  warehouses: [{ id: 'wh', name: 'Main', isDefault: true }],
  bins: [{ itemId: 'plus', warehouseId: 'wh', qty: 4, rate: 250 }],
  purchases: [],
  fx: { currency: 'PEN', base: 'USD', quote: 'PEN', rate: 3.75 },
} as unknown as ComponentProps<typeof StockEntry>['data'];

beforeEach(() => {
  flushSync(() => {
    page.url = new URL('http://localhost/stock/entries/new?type=receipt');
    page.data.user.id = 'actor-a';
    page.data.activeOrgId = 'org-a';
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([])),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function typeLine(qty: string, rate: string) {
  await fireEvent.click(screen.getByRole('button', { name: m.stock_add_items() }));
  await fireEvent.click(screen.getByRole('button', { name: 'pick HA Saypha Volume Plus' }));
  const [q, r] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
  await fireEvent.input(q, { target: { value: qty } });
  await fireEvent.input(r, { target: { value: rate } });
  return r;
}

it('warns on a total typed as unit cost, and "Es el total" makes it the line total', async () => {
  render(StockEntry, { data });
  const rate = await typeLine('89', '5474.58');

  const warning = screen.getByText(/5,474\.58/, { selector: 'span' }).closest('[role="status"]')!;
  expect(warning.textContent).toContain(
    m.stock_cost_warn_high({ rate: formatMoney(5474.58), times: '22', avg: formatMoney(250) }),
  );
  expect(warning.textContent).toContain(
    m.stock_cost_warn_total_hint({ qty: '89', unit: formatMoney(61.51) }),
  );
  expect(rate.getAttribute('aria-describedby')).toBe(warning.id);
  // Never blocks: registering stays available.
  expect(
    (screen.getByRole('button', { name: m.stock_submit() }) as HTMLButtonElement).disabled,
  ).toBe(false);

  await fireEvent.click(screen.getByRole('button', { name: m.stock_cost_warn_is_total() }));
  expect(rate.value).toBe('61.5121');
  expect(screen.queryByRole('button', { name: m.stock_cost_warn_is_total() })).toBeNull();
  expect(rate.getAttribute('aria-describedby')).toBeNull();
});

it('a plausible cost shows no warning', async () => {
  render(StockEntry, { data });
  await typeLine('10', '300');
  expect(screen.queryByRole('button', { name: m.stock_cost_warn_is_total() })).toBeNull();
});
