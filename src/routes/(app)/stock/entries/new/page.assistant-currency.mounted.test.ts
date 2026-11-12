// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync, tick, type ComponentProps } from 'svelte';
import StockEntry from './PageBody.svelte';
import { page } from '../../../../../../tests/fixtures/pending-submission/page.svelte';
import { executeTool, getTools, hasTool } from '$lib/assistant/model-context';
import * as m from '$lib/paraglide/messages';

vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$lib/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

const data = {
  items: [
    { id: 'item-a', code: 'A', name: 'First fixture item', uom: 'unit' },
    { id: 'item-b', code: 'B', name: 'Second fixture item', uom: 'unit' },
  ],
  warehouses: [{ id: 'warehouse-a', name: 'Fixture warehouse', isDefault: true }],
  bins: [],
  purchases: [],
  fx: { currency: 'PEN', base: 'USD', quote: 'PEN', rate: 3.75 },
} as unknown as ComponentProps<typeof StockEntry>['data'];

const numbers = (view: { container: HTMLElement }, index = 0) =>
  [
    ...view.container
      .querySelectorAll<HTMLTableRowElement>('table.mini-table tbody tr')
      [index].querySelectorAll<HTMLInputElement>('input[type="number"]'),
  ].map((input) => input.value);
const fill = async (input: Record<string, unknown>) => {
  const result = JSON.parse(await executeTool('fill_stock_entry', input));
  await tick();
  return result;
};
const mount = async (patch: Partial<typeof data> = {}) => {
  const view = render(StockEntry, { data: { ...data, ...patch } });
  await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
  return view;
};

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

it('publishes currency and rate-basis enums through the mounted fill interface', async () => {
  await mount();
  const tool = getTools().find((t) => t.name === 'fill_stock_entry')!;
  expect(tool.inputSchema).toMatchObject({
    properties: {
      currency: { enum: ['PEN', 'USD'] },
      rateMode: { enum: ['unit', 'total'] },
    },
  });
});

it('fills an explicit USD line total without pretending it is a per-unit cost', async () => {
  const view = await mount();
  const result = await fill({ item: 'A', qty: 20, rate: 2000, currency: 'USD', rateMode: 'total' });
  expect(result.rejected).toEqual([]);
  expect(result.filled).toEqual(expect.arrayContaining(['currency', 'rateMode', 'rate']));
  expect(view.getByRole('button', { name: 'USD' }).getAttribute('aria-pressed')).toBe('true');
  expect(
    view.getByRole('button', { name: m.stock_rate_mode_total() }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(numbers(view)).toEqual(['20', '2000']);
});

it('converts an omitted per-unit basis into the current total display basis', async () => {
  const view = await mount();
  await fireEvent.click(view.getByRole('button', { name: m.stock_rate_mode_total() }));
  await fill({ item: 'A', qty: 20, rate: 100 });
  expect(numbers(view)).toEqual(['20', '2000']);
});

it('preserves previous valued rows while changing the displayed rate basis', async () => {
  const view = await mount();
  await fill({ item: 'A', qty: 2, rate: 10 });
  await fill({ item: 'B', qty: 3, rate: 90, rateMode: 'total' });
  expect(numbers(view, 0)).toEqual(['2', '20']);
  expect(numbers(view, 1)).toEqual(['3', '90']);
});

it.each([{ currency: 'EUR' }, { rateMode: 'guess' }, { currency: 'USD' }])(
  'rejects invalid input or currency changes before mutating a valued draft: %j',
  async (patch) => {
    const view = await mount();
    await fill({ item: 'A', qty: 2, rate: 10 });
    const result = await fill({ item: 'B', qty: 3, rate: 100, ...patch });
    expect(result.rejected.length).toBeGreaterThan(0);
    expect(view.container.querySelectorAll('table.mini-table tbody tr')).toHaveLength(1);
    expect(numbers(view)).toEqual(['2', '10']);
    expect(view.getByRole('button', { name: 'PEN' }).getAttribute('aria-pressed')).toBe('true');
  },
);

it('does not reprice the previous row when the requested new item cannot be resolved', async () => {
  const view = await mount();
  await fill({ item: 'A', qty: 2, rate: 10 });
  const result = await fill({ item: 'zzzz-unknown', qty: 3, rate: 100 });
  expect(result.rejected).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'item' }),
      expect.objectContaining({ key: 'qty' }),
      expect.objectContaining({ key: 'rate' }),
    ]),
  );
  expect(numbers(view)).toEqual(['2', '10']);
});

it('rejects a missing-FX monetary fill without adding a misleading row', async () => {
  const view = await mount({ fx: { ...data.fx, rate: null } } as Partial<typeof data>);
  const result = await fill({ item: 'A', qty: 2, rate: 10, currency: 'USD' });
  expect(result.rejected.length).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('table.mini-table tbody tr')).toHaveLength(0);
});

it('preserves a human basis change during supplier lookup while retaining per-unit input meaning', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const view = await mount({
    items: [{ ...data.items[0], defaultSupplierPartyId: 'supplier-a' }],
  } as Partial<typeof data>);
  const running = fill({ item: 'A', qty: 20, rate: 100 });
  await waitFor(() => expect(release).toBeDefined());
  await fireEvent.click(view.getByRole('button', { name: m.stock_rate_mode_total() }));
  release(Response.json({ id: 'supplier-a', name: 'Fixture supplier', type: 'company' }));
  const result = await running;
  expect(result.rejected).toEqual([]);
  expect(numbers(view)).toEqual(['20', '2000']);
  expect(
    view.getByRole('button', { name: m.stock_rate_mode_total() }).getAttribute('aria-pressed'),
  ).toBe('true');
});

it('does not apply a stale currency interpretation after an awaited supplier lookup', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  const view = await mount({
    items: [{ ...data.items[0], defaultSupplierPartyId: 'supplier-a' }],
  } as Partial<typeof data>);
  const running = fill({ item: 'A', qty: 20, rate: 100, currency: 'USD' });
  await waitFor(() => expect(release).toBeDefined());
  await fireEvent.click(view.getByRole('button', { name: 'PEN' }));
  release(Response.json({ id: 'supplier-a', name: 'Fixture supplier', type: 'company' }));
  const result = await running;
  expect(result.rejected.some((r: { key: string }) => r.key === 'rate')).toBe(true);
  expect(numbers(view)).toEqual(['1', '']);
  expect(view.getByRole('button', { name: 'PEN' }).getAttribute('aria-pressed')).toBe('true');
});
