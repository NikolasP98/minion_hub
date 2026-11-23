// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import PageBody from './PageBody.svelte';
import * as m from '$lib/paraglide/messages';

vi.mock('$app/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/environment')>()),
  browser: true,
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

type Data = ComponentProps<typeof PageBody>['data'];
const row = (id: string, qtyDelta: string, name: string) => ({
  ledgerId: id,
  entryId: `e-${id}`,
  entryHref: `/stock/entries/e-${id}`,
  itemId: `i-${id}`,
  warehouseId: 'w1',
  postedAt: '2026-11-10T10:00:00.000001Z',
  qtyDelta,
  qtyAfter: '1',
  valuationRate: '1',
  valueDelta: '1',
  entryHumanId: `STE-${id}`,
  movementKind: 'transfer',
  movementKindState: 'available',
  item: { itemId: `i-${id}`, name, code: null },
  warehouseName: 'Main',
  document: null,
  sourceState: 'missing',
  counterpartyLabel: null,
  counterpartyState: 'missing',
  stockUnit: {
    currentItemUom: 'caja',
    currentState: 'available',
    historicalUom: null,
    historicalState: 'not_recorded',
  },
});
const base = (recentMovements: unknown, gaps: unknown[] = []) =>
  ({
    gaps,
    series: [],
    seriesDays: 90,
    totalValuation: 0,
    itemCount: 1,
    warehouseCount: 1,
    lowStock: [],
    hasData: true,
    recentMovements,
  }) as unknown as Data;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterEach(() => cleanup());

it('recent card keys rows by exact ledgerId, shows kind + entry link, keeps 20-row notice and no pager', () => {
  render(PageBody, {
    data: base({
      surface: 'recent',
      projection: 'full',
      nextCursor: null,
      enrichmentAvailability: 'available',
      reason: null,
      rows: [
        row('9007199254740993', '-2.50', 'Faja M'),
        row('9007199254740994', '1.250', 'Faja L'),
      ],
    }),
  });
  expect(screen.getAllByText('Faja M').length).toBeGreaterThan(0);
  expect(screen.getByText(/-2\.50/)).toBeTruthy(); // raw string, not Number()
  expect(screen.getByText('ENT-STE-9007199254740993').closest('a')!.getAttribute('href')).toBe(
    '/stock/entries/e-9007199254740993',
  );
  expect(screen.getAllByText(m.stock_mv_recent_notice()).length).toBeGreaterThan(0);
  expect(screen.queryByText(m.stock_mv_older())).toBeNull();
});

it('identity_only shows unavailable and disables value rendering', () => {
  render(PageBody, {
    data: base({
      surface: 'recent',
      projection: 'identity_only',
      nextCursor: null,
      enrichmentAvailability: 'unavailable',
      reason: 'capacity_limit',
      rows: [
        {
          ledgerId: '1',
          entryId: 'e1',
          entryHref: '/stock/entries/e1',
          itemId: 'i1',
          warehouseId: 'w1',
        },
      ],
    }),
  });
  expect(screen.getAllByText(m.stock_mv_unavailable_value()).length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(new RegExp(m.stock_mv_unavailable().slice(0, 20))).length,
  ).toBeGreaterThan(0);
});

const EMPTY_RECENT = {
  surface: 'recent',
  projection: 'full',
  nextCursor: null,
  enrichmentAvailability: 'available',
  reason: null,
  rows: [],
};
const gap = (itemId: string, itemName: string, amount: number) => ({
  itemId,
  itemName,
  warehouseId: 'w1',
  gap: amount,
  since: {
    entryId: `e-${itemId}`,
    type: 'adjustment',
    humanId: 'STE-1',
    postedAt: '2026-06-30T12:00:00.000Z',
  },
});

it('spec 144: no gap warning when every item adds up', () => {
  render(PageBody, { data: base(EMPTY_RECENT) });
  expect(screen.queryByText(m.stock_gaps_body())).toBeNull();
  expect(screen.queryByRole('button', { name: m.stock_gaps_view() })).toBeNull();
});

it('spec 144: two gaps show one warning; "Ver" lists item, amount and the first diverging movement', async () => {
  render(PageBody, {
    data: base(EMPTY_RECENT, [
      gap('i-opera', 'HA Opera I', 3512.68),
      gap('i-vol', 'HA Saypha Volume', 1673.91),
    ]),
  });
  expect(screen.getByText(m.stock_gaps_title({ count: 2 }))).toBeTruthy();
  expect(screen.queryByText('HA Opera I')).toBeNull();
  const view = screen.getByRole('button', { name: m.stock_gaps_view() });
  expect(view.getAttribute('aria-expanded')).toBe('false');
  await fireEvent.click(view);
  expect(screen.getAllByText('HA Opera I')[0].closest('a')!.getAttribute('href')).toBe(
    '/stock/items/i-opera',
  );
  expect(screen.getAllByText(/3,512\.68/).length).toBeGreaterThan(0);
  // "Desde": the first diverging movement's kind and date, linking to the item's history.
  const since = screen.getAllByText(new RegExp(`${m.stock_type_adjustment()} · .*2026`));
  expect(since.length).toBe(2);
  expect(since[0].closest('a')!.getAttribute('href')).toBe('/stock/items/i-opera');
});
