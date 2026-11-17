// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import PageBody from './PageBody.svelte';
import * as m from '$lib/paraglide/messages';
import { page } from '../../../../../../tests/fixtures/pending-submission/page.svelte';

vi.mock('$app/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/environment')>()),
  browser: true,
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

type Data = ComponentProps<typeof PageBody>['data'];
const ITEM = '33333333-3333-4333-8333-333333333333';
const full = (ledgerId: string, extra = {}) => ({
  ledgerId,
  entryId: 'e1',
  entryHref: '/stock/entries/e1',
  itemId: ITEM,
  warehouseId: 'w1',
  postedAt: '2026-11-10T10:00:00.000001Z',
  qtyDelta: '-2.50',
  qtyAfter: '7.5',
  valuationRate: '1.2000000001',
  valueDelta: '-3',
  entryHumanId: 'STE-1',
  movementKind: 'issue',
  movementKindState: 'available',
  item: { itemId: ITEM, name: 'Faja M', code: 'F' },
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
  ...extra,
});
const mk = (movements: unknown) =>
  ({
    uoms: [],
    item: { id: ITEM, name: 'Faja M', code: 'F', uom: 'caja', tags: [] },
    itemIds: [ITEM],
    warehouseCount: 1,
    customProperties: {
      definitions: [],
      values: {},
      recordAccess: {},
      canManage: false,
      canEdit: false,
    },
    bins: [],
    movements,
    consumedBy: [],
    tags: [],
    inheritedTags: [],
    allTags: [],
  }) as unknown as Data;

beforeEach(() => {
  page.url = new URL(`http://localhost/stock/items/${ITEM}?tab=x`);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterEach(() => cleanup());

it('renders two rows sharing an entryId as distinct, raw strings, current-unit context, and Older preserving other params', () => {
  render(PageBody, {
    data: mk({
      surface: 'item_ledger',
      projection: 'full',
      enrichmentAvailability: 'available',
      reason: null,
      nextCursor: 'NEXT',
      rows: [full('9007199254740993'), full('9007199254740994')],
    }),
  });
  expect(screen.getAllByText('ENT-STE-1')).toHaveLength(2);
  expect(screen.getAllByText(/-2\.50/)).toHaveLength(2);
  expect(screen.getAllByText('1.2000000001')).toHaveLength(2);
  expect(screen.getByTestId('ledger-unit').textContent).toContain(
    m.stock_mv_unit_current({ uom: 'caja' }),
  );
  expect(screen.getByTestId('ledger-unit').textContent).toContain(m.stock_mv_unit_unrecorded());
  expect(screen.getByText(m.stock_mv_valuation_unverified())).toBeTruthy();
  expect(screen.getByText(m.stock_mv_older()).closest('a')!.getAttribute('href')).toBe(
    `/stock/items/${ITEM}?tab=x&ledgerCursor=NEXT`,
  );
});

it('empty page with a cursor keeps Newest; identity_only shows unavailable, never zero', () => {
  page.url = new URL(`http://localhost/stock/items/${ITEM}?ledgerCursor=C`);
  render(PageBody, {
    data: mk({
      surface: 'item_ledger',
      projection: 'full',
      enrichmentAvailability: 'available',
      reason: null,
      nextCursor: null,
      rows: [],
    }),
  });
  expect(screen.getByText(m.stock_mv_newest()).closest('a')!.getAttribute('href')).toBe(
    `/stock/items/${ITEM}`,
  );
  cleanup();
  render(PageBody, {
    data: mk({
      surface: 'item_ledger',
      projection: 'identity_only',
      enrichmentAvailability: 'unavailable',
      reason: 'capacity_limit',
      nextCursor: null,
      rows: [
        {
          ledgerId: '1',
          entryId: 'e1',
          entryHref: '/stock/entries/e1',
          itemId: ITEM,
          warehouseId: 'w1',
        },
      ],
    }),
  });
  expect(screen.getByTestId('ledger-unavailable')).toBeTruthy();
  expect(screen.queryByText(m.stock_mv_valuation_unverified())).toBeNull();
});
