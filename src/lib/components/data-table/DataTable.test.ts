// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { createRawSnippet, type Component } from 'svelte';
import { Button } from '@minion-stack/ui';
import { page } from '$app/state';

// DataTable's row virtualizer only initializes `if (browser && wrapperEl)` (see
// DataTable.svelte's `rowVirt` derivation) — force `browser: true` here so rows
// actually mount under test. This override is file-local: every other test in
// the suite keeps the real default (`browser: false`) from
// src/server/test-utils/env-stubs/app-environment.ts, which this file's import
// preserves via `importOriginal`.
vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

// Spy on the row virtualizer's constructor to guard the 2026-09-16 regression:
// DataTable's `rowVirt` used to be a `$derived` that read `flatItems.length`
// while building the virtualizer's options, so every row expand/collapse (any
// change to flatItems.length) reran createVirtualizer() and threw away the
// live instance — which drops its measured row heights and its scrollOffset,
// visually snapping the list back to the top. The fix keeps one instance
// alive for the component's lifetime and pushes count updates through
// `setOptions()` instead.
const createVirtualizerSpy = vi.fn();
// Every scrollToOffset() call across ALL instances. testing-library's
// `rerender` swaps the whole props object, which re-derives `rowVirt` (a
// harness artifact — in the app only the changed prop's signal fires), so a
// spy pinned to one instance would go stale after a rerender.
const scrollToOffsetCalls: number[] = [];
vi.mock('$lib/virtual/virtualizer.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/virtual/virtualizer.svelte')>();
  return {
    ...actual,
    createVirtualizer: (...args: Parameters<typeof actual.createVirtualizer>) => {
      createVirtualizerSpy(...args);
      const inst = actual.createVirtualizer(...args);
      const orig = inst.scrollToOffset;
      inst.scrollToOffset = (offset, opts) => {
        scrollToOffsetCalls.push(offset);
        return orig(offset, opts);
      };
      return inst;
    },
  };
});

const { default: DataTable } = await import('./DataTable.svelte');
type DataColumn<T> = import('./DataTable.svelte').DataColumn<T>;

beforeAll(() => {
  // happy-dom has no layout engine, so TanStack Virtual observes a zero-height
  // viewport unless this test supplies deterministic element dimensions.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});

afterAll(() => vi.restoreAllMocks());

describe('Button DOM mount (shared @minion-stack/ui primitive)', () => {
  // Reproduces (and guards) the crash the S4 follow-up proposal reported:
  // ANY mounted Button.svelte instance threw `Cannot read properties of null
  // (reading 'Symbol(parentNode)')` inside happy-dom@15.11's `Node.nextSibling`
  // getter, from Button's <svelte:element> insertion effect. Fixed by bumping
  // happy-dom to ^20.10 (package.json) — no @minion-stack/ui or jsdom change
  // needed.
  it('mounts, exposes its accessible role/name, and tears down cleanly', () => {
    const children = createRawSnippet(() => ({
      render: () => `<span>Click me</span>`,
      setup: () => {},
    }));
    const { getByRole, unmount } = render(Button, { props: { children } });
    expect(getByRole('button', { name: 'Click me' })).toBeTruthy();
    expect(() => unmount()).not.toThrow();
    cleanup();
  });
});

type Row = { id: string; name: string };
type DataTableProps<T> = {
  data: T[];
  columns: DataColumn<T>[];
  getRowId: (row: T) => string;
};
type ServerMode = import('./DataTable.svelte').ServerMode;

// Testing Library cannot infer a concrete type argument from a generic Svelte
// component import, so bind the fixture's Row contract at this test boundary.
const RowDataTable = DataTable as Component<DataTableProps<Row>>;
const ServerRowDataTable = DataTable as Component<DataTableProps<Row> & { server: ServerMode }>;
const columns: DataColumn<Row>[] = [{ key: 'name', label: 'Name' }];
const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];

describe('DataTable DOM mount (browser=true row virtualization)', () => {
  it('renders at least one real tbody row once browser === true', async () => {
    const { container, unmount } = render(RowDataTable, {
      props: { data: rows, columns, getRowId: (r: Row) => r.id },
    });
    await waitFor(() => {
      const bodyRows = container.querySelectorAll('tbody tr[data-row-index]');
      expect(bodyRows.length).toBeGreaterThanOrEqual(1);
    });
    unmount();
    cleanup();
  });
});

describe('DataTable handoff marker block', () => {
  // Covers the server-mode block (spec 2026-08-13 §S4): in server mode, a
  // header sort click must delegate to `server.onQuery` instead of sorting
  // `data` client-side.
  it('server mode: clicking a sortable header calls server.onQuery with the sort, not a local sort', async () => {
    const onQuery = vi.fn();
    const server: ServerMode = { total: rows.length, onQuery };
    const { getByRole, unmount } = render(ServerRowDataTable, {
      props: { data: rows, columns, getRowId: (r: Row) => r.id, server },
    });

    const header = getByRole('button', { name: 'Name' });
    await fireEvent.click(header);

    await waitFor(() => {
      expect(onQuery).toHaveBeenCalledWith(
        expect.objectContaining({ sort: { key: 'name', dir: 'asc' } }),
      );
    });

    unmount();
    cleanup();
  });

  // Deliberately reverse-of-ascending server fixture: if `view` ever fell
  // through to the local search/filter/sort pipeline instead of returning
  // `data` verbatim (the `if (server) return data` guard this marker sits
  // beside), the asc-sort click above would flip these rows to Alpha, Beta
  // and this assertion would catch it — the prior onQuery-only test could
  // not, since its fixture was already in ascending order.
  it('server mode: does not locally re-sort already server-ranked rows', async () => {
    const onQuery = vi.fn();
    const serverRows: Row[] = [
      { id: '2', name: 'Beta' },
      { id: '1', name: 'Alpha' },
    ];
    const server: ServerMode = { total: serverRows.length, onQuery };
    const { getByRole, getAllByRole, unmount } = render(ServerRowDataTable, {
      props: { data: serverRows, columns, getRowId: (r: Row) => r.id, server },
    });

    const header = getByRole('button', { name: 'Name' });
    await fireEvent.click(header);

    await waitFor(() => {
      expect(onQuery).toHaveBeenCalledWith(
        expect.objectContaining({ sort: { key: 'name', dir: 'asc' } }),
      );
    });

    await waitFor(() => {
      const cells = getAllByRole('cell');
      expect(cells.map((c) => c.textContent?.trim())).toEqual(['Beta', 'Alpha']);
    });

    unmount();
    cleanup();
  });
});

describe('DataTable cell editing (Notion-style cells + Excel fill handle)', () => {
  // The pencil row-mode (sticky actions column) was replaced 2026-09-20 by
  // per-cell editing: an editable column's cell selects on click, opens an
  // in-place editor on the second click / Enter / typing, commits on Enter
  // (moving down) and cancels on Escape. Every commit still calls the
  // unchanged `onSaveRow(row, draft)` with the FULL editable snapshot plus
  // the change, so existing partial-PATCH callers keep working unchanged.
  type EditRow = { id: string; name: string; qty: number; active: boolean };
  const editColumns: DataColumn<EditRow>[] = [
    { key: 'name', label: 'Name', editable: true },
    { key: 'qty', label: 'Qty', align: 'right', editable: true, type: 'number' },
    { key: 'active', label: 'Active', editable: true, type: 'boolean' },
    { key: 'id', label: 'Id' },
  ];
  const editRows: EditRow[] = [
    { id: '1', name: 'Widget', qty: 3, active: true },
    { id: '2', name: 'Gadget', qty: 5, active: false },
    { id: '3', name: 'Gizmo', qty: 7, active: false },
  ];
  const EditDataTable = DataTable as Component<
    DataTableProps<EditRow> & {
      onSaveRow: (row: EditRow, draft: Record<string, string>) => Promise<boolean>;
      canEdit?: boolean;
      onSaveComplete?: () => Promise<void>;
    }
  >;
  const cellOf = (container: HTMLElement, rowIndex: number, key: string) =>
    container.querySelector<HTMLTableCellElement>(
      `tbody tr[data-row-index="${rowIndex}"] td[data-col="${key}"]`,
    )!;
  type SaveFn = (row: EditRow, draft: Record<string, string>) => Promise<boolean>;
  const saveSpy = (ok = true) => vi.fn<SaveFn>(async () => ok);
  const savedArgs = (fn: ReturnType<typeof saveSpy>) =>
    fn.mock.calls.map(([row, draft]) => [row, draft] as const);
  async function mount(
    onSaveRow = saveSpy(),
    canEdit = true,
    onSaveComplete?: () => Promise<void>,
  ) {
    const r = render(EditDataTable, {
      props: {
        data: editRows,
        columns: editColumns,
        getRowId: (r) => r.id,
        onSaveRow,
        canEdit,
        onSaveComplete,
      },
    });
    await waitFor(() => {
      expect(r.container.querySelectorAll('tbody tr[data-row-index]').length).toBe(3);
    });
    return r;
  }

  it('has no actions column any more and marks only editable cells', async () => {
    const { container, unmount } = await mount();
    expect(container.querySelector('.dt-actions-cell')).toBeNull();
    expect(cellOf(container, 0, 'name').classList.contains('dt-editable')).toBe(true);
    expect(cellOf(container, 0, 'id').classList.contains('dt-editable')).toBe(false);
    unmount();
    cleanup();
  });

  it('canEdit=false renders read-only cells', async () => {
    const { container, unmount } = await mount(saveSpy(), false);
    expect(cellOf(container, 0, 'name').classList.contains('dt-editable')).toBe(false);
    unmount();
    cleanup();
  });

  it('click selects, second click opens the editor, Enter commits the full draft and moves down', async () => {
    const onSaveRow = saveSpy();
    const { container, unmount } = await mount(onSaveRow);
    const cell = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(cell, { button: 0 });
    expect(cell.classList.contains('dt-sel-focus')).toBe(true);
    expect(cell.querySelector('input')).toBeNull();

    await fireEvent.pointerDown(cell, { button: 0 });
    const input = cell.querySelector<HTMLInputElement>('input.dt-inp');
    expect(input).toBeTruthy();
    await fireEvent.input(input!, { target: { value: 'Widget XL' } });
    await fireEvent.keyDown(input!, { key: 'Enter' });

    expect(onSaveRow).toHaveBeenCalledTimes(1);
    const [row, draft] = savedArgs(onSaveRow)[0];
    expect(row.id).toBe('1');
    // Full editable snapshot + the change (never a partial that could wipe siblings).
    expect(draft).toEqual({ name: 'Widget XL', qty: '3', active: 'true' });
    // Enter moved the selection one row down.
    await waitFor(() => {
      expect(cellOf(container, 1, 'name').classList.contains('dt-sel-focus')).toBe(true);
    });
    unmount();
    cleanup();
  });

  it('Escape cancels without saving; an unchanged commit does not save', async () => {
    const onSaveRow = saveSpy();
    const { container, unmount } = await mount(onSaveRow);
    const cell = cellOf(container, 1, 'qty');
    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.pointerDown(cell, { button: 0 });
    const input = cell.querySelector<HTMLInputElement>('input.dt-inp')!;
    expect(input.type).toBe('number');
    await fireEvent.input(input, { target: { value: '99' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(cell.querySelector('input')).toBeNull();
    expect(onSaveRow).not.toHaveBeenCalled();

    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.keyDown(cell.querySelector('input')!, { key: 'Enter' });
    expect(onSaveRow).not.toHaveBeenCalled();
    unmount();
    cleanup();
  });

  it('a boolean cell toggles and saves on the second click', async () => {
    const onSaveRow = saveSpy();
    const { container, unmount } = await mount(onSaveRow);
    const cell = cellOf(container, 1, 'active');
    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.pointerDown(cell, { button: 0 });
    expect(onSaveRow).toHaveBeenCalledTimes(1);
    expect(savedArgs(onSaveRow)[0][1]).toEqual({ name: 'Gadget', qty: '5', active: 'true' });
    unmount();
    cleanup();
  });

  it('a failed save marks the cell instead of silently reverting', async () => {
    const onSaveRow = saveSpy(false);
    const { container, unmount } = await mount(onSaveRow);
    const cell = cellOf(container, 2, 'active');
    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.pointerDown(cell, { button: 0 });
    await waitFor(() => {
      expect(cellOf(container, 2, 'active').classList.contains('dt-failed')).toBe(true);
    });
    unmount();
    cleanup();
  });

  it('a data refresh after a commit does not snap the list back to the top', async () => {
    // Root cause: the snap-to-top effect was keyed on `view`, which derives
    // from the rows prop — so the re-fetch after every save scrolled to 0.
    const onSaveRow = saveSpy();
    const { container, rerender } = await mount(onSaveRow);
    scrollToOffsetCalls.length = 0;
    const cell = cellOf(container, 1, 'qty');
    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.pointerDown(cell, { button: 0 });
    const input = cell.querySelector<HTMLInputElement>('input.dt-inp')!;
    await fireEvent.input(input, { target: { value: '9' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onSaveRow).toHaveBeenCalledTimes(1));
    // The caller re-fetches: the rows prop gets a NEW array identity with the
    // saved value. That is a data refresh, not a query change — no snap.
    await rerender({ data: editRows.map((r) => (r.id === '2' ? { ...r, qty: 9 } : { ...r })) });
    expect(cellOf(container, 1, 'qty').textContent?.trim()).toBe('9');
    expect(scrollToOffsetCalls).toEqual([]);
    // A real query change (sort) still snaps to the top.
    const header = [...container.querySelectorAll<HTMLElement>('thead th')].find((th) =>
      /qty/i.test(th.textContent ?? ''),
    )!;
    await fireEvent.click(header.querySelector('button')!);
    await waitFor(() => expect(scrollToOffsetCalls).toContain(0));
  });

  it('fill handle: dragging the corner down repeats the selected block into the covered rows', async () => {
    const onSaveRow = saveSpy();
    const onSaveComplete = vi.fn(async () => {});
    const { container, unmount } = await mount(onSaveRow, true, onSaveComplete);
    const src = cellOf(container, 0, 'qty');
    await fireEvent.pointerDown(src, { button: 0 });
    const handle = src.querySelector<HTMLElement>('.dt-fill');
    expect(handle).toBeTruthy();
    await fireEvent.pointerDown(handle!, { button: 0 });
    // happy-dom has no layout: stub the hit-test to land on row 2.
    const target = container.querySelector<HTMLElement>('tbody tr[data-row-index="2"]')!;
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    await fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();

    // Rows 1 and 2 receive row 0's qty; row 0 itself is untouched.
    expect(onSaveRow).toHaveBeenCalledTimes(2);
    const saved = savedArgs(onSaveRow).map(([row, draft]) => [row.id, draft.qty] as const);
    expect(saved).toEqual([
      ['2', '3'],
      ['3', '3'],
    ]);
    await waitFor(() => expect(onSaveComplete).toHaveBeenCalledTimes(1));
    unmount();
    cleanup();
  });
});

describe('DataTable table registry: ID column, Title column, org config (2026-09-21)', () => {
  // Owner directive: every user-facing table gets an ID column with a
  // configurable PREFIX over the entity's human code (never the UUID, never
  // editable) and a Title column that opens the record. Owners tune prefix and
  // per-field label / visibility / editability on /settings/tables; the org
  // document rides on page.data.tableConfig (app layout).
  type ItemRow = { id: string; code: string; name: string; uom: string };
  const itemRows: ItemRow[] = [
    { id: 'u1', code: '1261', name: 'Acido', uom: 'ml' },
    { id: 'u2', code: 'EUDA', name: 'Eudaria', uom: 'unit' },
  ];
  const itemColumns: DataColumn<ItemRow>[] = [
    { key: 'name', label: 'Name', editable: true },
    { key: 'uom', label: 'UOM' },
  ];
  const ItemTable = DataTable as Component<
    DataTableProps<ItemRow> & {
      tableId?: string;
      idColumn?: { value: (r: ItemRow) => string };
      titleColumn?: { key: string; href: (r: ItemRow) => string };
      onSaveRow?: (row: ItemRow, draft: Record<string, string>) => Promise<boolean>;
    }
  >;
  const headers = (c: HTMLElement) =>
    [...c.querySelectorAll('thead th')].map((th) => th.textContent?.trim()).filter(Boolean);
  async function mountItems(extra: Record<string, unknown> = {}) {
    const r = render(ItemTable, {
      props: {
        data: itemRows,
        columns: itemColumns,
        getRowId: (r) => r.id,
        tableId: 'stock.items',
        idColumn: { value: (r) => r.code },
        titleColumn: { key: 'name', href: (r) => `/stock/items/${r.id}` },
        ...extra,
      },
    });
    await waitFor(() =>
      expect(r.container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2),
    );
    return r;
  }
  const cellText = (c: HTMLElement, row: number, key: string) =>
    c.querySelector(`tbody tr[data-row-index="${row}"] td[data-col="${key}"]`)?.textContent?.trim();

  it('synthesises a leading, read-only ID column = registry default prefix + human code', async () => {
    page.data = {};
    const { container } = await mountItems();
    expect(headers(container)[0]).toBe('ID');
    expect(cellText(container, 0, '__id')).toBe('ITM-1261');
    expect(cellText(container, 1, '__id')).toBe('ITM-EUDA');
    const idCell = container.querySelector('tbody tr[data-row-index="0"] td[data-col="__id"]')!;
    expect(idCell.classList.contains('dt-editable')).toBe(false);
  });

  it('the Title column links into the record: an open affordance always, the text itself when not editable', async () => {
    page.data = {};
    const { container } = await mountItems({ onSaveRow: async () => true });
    const nameCell = container.querySelector('tbody tr[data-row-index="0"] td[data-col="name"]')!;
    expect(nameCell.classList.contains('dt-editable')).toBe(true);
    expect(nameCell.querySelector('a.dt-open')?.getAttribute('href')).toBe('/stock/items/u1');
    // editable title: the text stays a plain (editable) value, no text link
    expect(nameCell.querySelector('a.dt-title-link')).toBeNull();
    const { container: ro } = await mountItems({
      columns: [{ key: 'name', label: 'Name' }, itemColumns[1]],
    });
    const roCell = ro.querySelector('tbody tr[data-row-index="0"] td[data-col="name"]')!;
    expect(roCell.querySelector('a.dt-title-link')?.getAttribute('href')).toBe('/stock/items/u1');
  });

  it('applies the org config: prefix, label override, default visibility, editing switched off', async () => {
    page.data = {
      tableConfig: {
        'stock.items': {
          idPrefix: 'INS-',
          fields: { name: { label: 'Producto', editable: false }, uom: { hidden: true } },
        },
      },
    };
    const { container } = await mountItems({ onSaveRow: async () => true });
    expect(cellText(container, 0, '__id')).toBe('INS-1261');
    expect(headers(container)).toEqual(['ID', 'Producto']);
    expect(container.querySelector('td[data-col="uom"]')).toBeNull();
    const nameCell = container.querySelector('tbody tr[data-row-index="0"] td[data-col="name"]')!;
    expect(nameCell.classList.contains('dt-editable')).toBe(false);
    page.data = {};
  });
});

describe('DataTable variant="plain" (embedded, intrinsic height)', () => {
  // Embedded read-mostly tables (detail cards, panels) render every row with
  // no virtualizer and no toolbar chrome, so the PAGE scrolls, not the table.
  it('renders all rows without creating a virtualizer and without the toolbar', async () => {
    createVirtualizerSpy.mockClear();
    const PlainDataTable = DataTable as Component<DataTableProps<Row> & { variant: 'plain' }>;
    const { container, unmount } = render(PlainDataTable, {
      props: { variant: 'plain', data: rows, columns, getRowId: (r: Row) => r.id },
    });
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2);
    });
    expect(createVirtualizerSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.dt-toolbar')).toBeNull();
    // Height is intrinsic, WIDTH is contained: without a horizontal scroller the
    // table's min-width pushed the whole page sideways (regression 2026-09-25,
    // /stock/entries/[id]).
    const scroller = container.querySelector('.dt-scroll')!;
    expect(scroller.classList.contains('overflow-x-auto')).toBe(true);
    expect(scroller.classList.contains('overflow-visible')).toBe(false);
    unmount();
    cleanup();
  });
});

describe('DataTable row expand keeps scroll position (regression 2026-09-16)', () => {
  // Root cause: `rowVirt` was a `$derived` that read `flatItems.length` while
  // building the virtualizer's options, so ANY change to flatItems.length —
  // every row expand/collapse — reran `createVirtualizer()` (see the mock
  // above) and threw away the live instance. The fresh instance's
  // `scrollOffset` starts `null` and only syncs from a real "scroll" DOM
  // event, so it renders as if scrolled to the top until the next scroll —
  // visually snapping the list back up. The fix keeps one virtualizer
  // instance alive for the table's lifetime and pushes count updates through
  // `setOptions()` instead of recreating it.
  type ExpRow = { id: string; name: string; children: ExpRow[] };
  it('creates the virtualizer once and reuses it across row expand/collapse', async () => {
    const many: ExpRow[] = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i}`,
      children: [{ id: `r${i}-child`, name: `Child of row ${i}`, children: [] }],
    }));
    const ExpDataTable = DataTable as Component<
      DataTableProps<ExpRow> & { getSubRows: (r: ExpRow) => ExpRow[] }
    >;
    createVirtualizerSpy.mockClear();
    const { container, unmount } = render(ExpDataTable, {
      props: {
        data: many,
        columns: [{ key: 'name', label: 'Name' }],
        getRowId: (r: ExpRow) => r.id,
        getSubRows: (r: ExpRow) => r.children,
      },
    });

    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBeGreaterThan(0);
    });
    expect(createVirtualizerSpy).toHaveBeenCalledTimes(1);

    // Expand a row (flatItems.length grows by one child row)...
    const expandBtn = container.querySelector<HTMLButtonElement>('.dt-exp');
    expect(expandBtn).toBeTruthy();
    await fireEvent.click(expandBtn!);
    expect(createVirtualizerSpy).toHaveBeenCalledTimes(1);
    // ...and the new child row actually renders (guards the sibling bug this
    // fix has to avoid: `setOptions()` alone doesn't make virtual-core
    // recompute, so the rendered rows would stay stale/out-of-bounds until
    // the next real scroll event — see `$lib/virtual/virtualizer.svelte.ts`).
    await waitFor(
      () => {
        expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(11);
      },
      { timeout: 2000 },
    );

    // ...and collapse it again (flatItems.length shrinks back). Neither
    // change may have recreated the virtualizer.
    await fireEvent.click(expandBtn!);
    expect(createVirtualizerSpy).toHaveBeenCalledTimes(1);
    await waitFor(
      () => {
        expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(10);
      },
      { timeout: 2000 },
    );

    unmount();
    cleanup();
  });
});
