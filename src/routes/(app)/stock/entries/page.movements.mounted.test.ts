// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import PageBody from './PageBody.svelte';
import { toCsv } from '$lib/export/table-export';
import * as m from '$lib/paraglide/messages';
import { page } from '../../../../../tests/fixtures/pending-submission/page.svelte';

// Rows only mount when the virtualizer sees a viewport (happy-dom has no layout).
vi.mock('$app/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$app/environment')>()),
  browser: true,
}));
const exported = vi.hoisted(() => ({ rows: [] as (string | number)[][] }));
vi.mock('$lib/export/table-export', async (original) => ({
  ...(await original<typeof import('$lib/export/table-export')>()),
  downloadCsv: (_name: string, rows: (string | number)[][]) => {
    exported.rows = rows;
  },
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(), goto: vi.fn(), afterNavigate: vi.fn() }));
vi.mock('$lib/navigation', async (original) => ({
  ...(await original<typeof import('$lib/navigation')>()),
  goto: vi.fn(),
}));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));

type Data = ComponentProps<typeof PageBody>['data'];
const I1 = '33333333-3333-4333-8333-333333333333';
const I2 = '44444444-4444-4444-8444-444444444444';
const W1 = '55555555-5555-4555-8555-555555555555';
const custom = { definitions: [], values: {}, recordAccess: {}, canManage: false, canEdit: false };
const mkRow = (n: number, extra = {}) => ({
  entryId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  entryHref: `/stock/entries/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'issue',
  status: 'submitted',
  createdAt: `2026-11-1${n}T10:00:00.000001Z`,
  postedAt: null,
  lineCount: 2,
  attachmentCount: 0,
  firstFromWarehouseId: W1,
  firstToWarehouseId: null,
  humanId: `STE-${n}`,
  note: null,
  itemSummary: { first: { itemId: I1, name: 'Faja M', code: 'FAJ-M' }, additionalItemCount: 1 },
  itemSearchText: 'FAJ-M Faja M FAJ-L Faja L',
  lines: [
    {
      lineId: 'l1',
      lineNo: 0,
      itemId: I1,
      qty: '2',
      uom: 'caja',
      rate: '12.3456789',
      fromWarehouseId: W1,
      toWarehouseId: null,
    },
    {
      lineId: 'l2',
      lineNo: 1,
      itemId: I2,
      qty: '1.500',
      uom: null,
      rate: null,
      fromWarehouseId: W1,
      toWarehouseId: null,
    },
  ],
  partyName: null,
  partyState: 'missing',
  document: null,
  sourceState: 'missing',
  ...extra,
});
const full = (rows: unknown[], nextCursor: string | null = null) =>
  ({
    stock: {
      customProperties: custom,
      partyFilter: null,
      warehouseCount: 2,
      movements: {
        surface: 'entries',
        projection: 'full',
        rows,
        nextCursor,
        enrichmentAvailability: 'available',
        reason: null,
        itemsById: {
          [I1]: { name: 'Faja M', code: 'FAJ-M' },
          [I2]: { name: 'Faja L', code: 'FAJ-L' },
        },
        warehousesById: { [W1]: 'Main' },
      },
    },
  }) as unknown as { stock: Data };

const fetchMock = vi.fn();
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.stubGlobal('fetch', fetchMock);
  page.url = new URL('http://localhost/stock/entries');
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

it('shows the first item plus additional count, the scope notice, and Older keeping ?party=', async () => {
  page.url = new URL('http://localhost/stock/entries?party=p1');
  render(PageBody, { data: full([mkRow(1)], 'CUR').stock });
  expect(screen.getByText(/Faja M/)).toBeTruthy();
  expect(screen.getByText(/\+1 more|\+1 más/)).toBeTruthy();
  expect(screen.getByTestId('movements-scope-note').textContent).toContain(
    m.stock_mv_scope_notice(),
  );
  const older = screen.getByText(m.stock_mv_older()).closest('a')!;
  expect(older.getAttribute('href')).toBe('/stock/entries?party=p1&cursor=CUR');
  expect(screen.queryByText(m.stock_mv_newest())).toBeNull();
});

it('Newest appears only with a cursor and drops just the cursor', () => {
  page.url = new URL('http://localhost/stock/entries?party=p1&cursor=CUR');
  render(PageBody, { data: full([mkRow(1)]).stock });
  expect(screen.getByText(m.stock_mv_newest()).closest('a')!.getAttribute('href')).toBe(
    '/stock/entries?party=p1',
  );
  expect(screen.queryByText(m.stock_mv_older())).toBeNull();
});

it('an empty raw page with a cursor keeps Newest reachable', () => {
  page.url = new URL('http://localhost/stock/entries?cursor=CUR');
  render(PageBody, { data: full([]).stock });
  expect(screen.getByText(m.stock_mv_page_empty())).toBeTruthy();
  expect(screen.getByText(m.stock_mv_newest()).closest('a')!.getAttribute('href')).toBe(
    '/stock/entries',
  );
});

it('expanding a full row issues zero /api/stock/entries/:id requests and lists every line', async () => {
  render(PageBody, { data: full([mkRow(1), mkRow(2)]).stock });
  const expanders = screen.getAllByRole('button', { name: /expand|expandir/i });
  await fireEvent.click(expanders[0]);
  expect(screen.getByText('1.500 · ' + m.stock_mv_unit_none())).toBeTruthy();
  expect(screen.getByText('2 caja')).toBeTruthy();
  expect(screen.getByText(m.stock_mv_valuation_unverified())).toBeTruthy();
  expect(
    fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/stock/entries/')),
  ).toHaveLength(0);
});

it('base_values_only renders unavailable, no item summary and no expansion', () => {
  const rows = [mkRow(1)].map((r) => ({
    entryId: r.entryId,
    entryHref: r.entryHref,
    type: r.type,
    status: r.status,
    createdAt: r.createdAt,
    postedAt: null,
    lineCount: 2,
    attachmentCount: 0,
    firstFromWarehouseId: W1,
    firstToWarehouseId: null,
  }));
  const data = {
    stock: {
      customProperties: custom,
      partyFilter: null,
      warehouseCount: 2,
      movements: {
        surface: 'entries',
        projection: 'base_values_only',
        rows,
        nextCursor: null,
        enrichmentAvailability: 'unavailable',
        reason: 'capacity_limit',
      },
    },
  } as unknown as { stock: Data };
  render(PageBody, { data: data.stock });
  expect(screen.getByTestId('movements-scope-note').textContent).toContain(
    m.stock_mv_unavailable(),
  );
  expect(screen.queryByText(/Faja M/)).toBeNull();
  expect(screen.queryAllByRole('button', { name: /expand|expandir/i })).toHaveLength(0);
});

it('exports the lineDetails column right after Lines with exact raw strings and no currency', async () => {
  const a = mkRow(1);
  const b = mkRow(2, {
    lines: [],
    lineCount: 0,
    itemSummary: { first: null, additionalItemCount: 0 },
  });
  render(PageBody, { data: full([a, b]).stock });
  await fireEvent.click(screen.getByLabelText(m.data_table_export()));
  await fireEvent.click(screen.getByRole('button', { name: m.crm_export_download({ count: 2 }) }));
  const [header, rowB, rowA] = exported.rows; // created desc: B is newer
  const i = header.indexOf(m.stock_col_lines());
  expect(header[i + 1]).toBe(m.stock_mv_lines_export());
  expect(rowA[i + 1]).toBe(
    JSON.stringify([
      {
        lineNo: 0,
        itemCode: 'FAJ-M',
        itemName: 'Faja M',
        qty: '2',
        uom: 'caja',
        rate: '12.3456789',
        calculatedAmount: '24.6913578',
        fromWarehouse: 'Main',
        toWarehouse: null,
      },
      {
        lineNo: 1,
        itemCode: 'FAJ-L',
        itemName: 'Faja L',
        qty: '1.500',
        uom: null,
        rate: null,
        calculatedAmount: null,
        fromWarehouse: 'Main',
        toWarehouse: null,
      },
    ]),
  );
  expect(rowB[i + 1]).toBe('[]');
  expect(String(rowA[i + 1])).not.toMatch(/S\/|PEN|USD|\$/);
  expect(toCsv([[String(rowA[i + 1])]])).toContain('"[{""lineNo"":0');
});
