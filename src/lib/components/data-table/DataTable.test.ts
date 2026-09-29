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

// Record open mode (spec 2026-09-28 "table open modes"): DataTable only
// WIRES `openModeFor`/`peekClick`/`openRecord` into its clicks — the mode
// resolution and shallow-routing mechanics belong to `$lib/records/peek.svelte`
// (its own module, exercised elsewhere). Replacing it with spies keeps these
// tests about the wiring, not the mechanism.
const peekClickCalls: [string, string][] = [];
const openRecordCalls: [string, string][] = [];
vi.mock('$lib/records/peek.svelte', () => ({
  OPEN_MODES: ['page', 'modal', 'tray'],
  isOpenMode: (v: unknown) => typeof v === 'string' && ['page', 'modal', 'tray'].includes(v),
  openModeFor: (_tableId: string | null | undefined, explicit?: string | null) =>
    explicit ?? 'page',
  peekClick: (href: string, mode: string) => (_e: MouseEvent) => {
    peekClickCalls.push([href, mode]);
  },
  openRecord: async (href: string, mode: string) => {
    openRecordCalls.push([href, mode]);
  },
}));

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

  it('getItemKey survives an index flatItems has already dropped', async () => {
    // The count-sync effect runs a pass LATER than the render, so on any shrink
    // of flatItems (group collapse / switching a groupBy axis on) virtual-core
    // still asks for keys past the end. Unguarded that threw an uncaught
    // TypeError from inside the virtualizer.
    const { unmount } = render(RowDataTable, {
      props: { data: rows, columns, getRowId: (r: Row) => r.id },
    });
    await waitFor(() => expect(createVirtualizerSpy).toHaveBeenCalled());
    const options = createVirtualizerSpy.mock.calls.at(-1)?.[0] as {
      getItemKey: (i: number) => string | number;
    };
    expect(() => options.getItemKey(9_999)).not.toThrow();
    expect(options.getItemKey(9_999)).toBe(9_999);
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

describe('DataTable select-type editable cell (uom-style options callback)', () => {
  // Mirrors /stock/items' `uom` column: `editable: true, type: 'select',
  // options: () => [...]`. A value the caller's options() doesn't list (an
  // item edited before the option existed) must still display as plain text
  // via the existing options→label lookup fallback, never blank out.
  type SelRow = { id: string; unit: string };
  const selColumns: DataColumn<SelRow>[] = [
    {
      key: 'unit',
      label: 'Unit',
      editable: true,
      type: 'select',
      options: () => [
        { value: 'kg', label: 'kg' },
        { value: 'unit', label: 'unit' },
      ],
    },
  ];
  const selRows: SelRow[] = [
    { id: '1', unit: 'kg' },
    { id: '2', unit: 'legacy-oz' }, // not in options() — must not blank out
  ];
  const SelDataTable = DataTable as Component<
    DataTableProps<SelRow> & {
      onSaveRow: (row: SelRow, draft: Record<string, string>) => Promise<boolean>;
    }
  >;
  const selCellOf = (container: HTMLElement, rowIndex: number, key: string) =>
    container.querySelector<HTMLTableCellElement>(
      `tbody tr[data-row-index="${rowIndex}"] td[data-col="${key}"]`,
    )!;
  type SelSaveFn = (row: SelRow, draft: Record<string, string>) => Promise<boolean>;

  it('a value missing from options() renders as plain text, not blank', async () => {
    const { container, unmount } = render(SelDataTable, {
      props: { data: selRows, columns: selColumns, getRowId: (r) => r.id, onSaveRow: vi.fn() },
    });
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2);
    });
    expect(selCellOf(container, 1, 'unit').textContent?.trim()).toBe('legacy-oz');
    unmount();
    cleanup();
  });

  it('second click opens a select built from options(); choosing one commits and saves', async () => {
    const onSaveRow = vi.fn<SelSaveFn>(async () => true);
    const { container, unmount } = render(SelDataTable, {
      props: { data: selRows, columns: selColumns, getRowId: (r) => r.id, onSaveRow },
    });
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2);
    });
    const cell = selCellOf(container, 0, 'unit');
    await fireEvent.pointerDown(cell, { button: 0 });
    await fireEvent.pointerDown(cell, { button: 0 });
    const select = cell.querySelector<HTMLSelectElement>('select.dt-inp');
    expect(select).toBeTruthy();
    expect([...select!.options].map((o) => o.value)).toEqual(['kg', 'unit']);
    await fireEvent.change(select!, { target: { value: 'unit' } });
    expect(onSaveRow).toHaveBeenCalledTimes(1);
    const [, draft] = onSaveRow.mock.calls[0];
    expect(draft.unit).toBe('unit');
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

  it('resizable defaults to true even for the plain variant (owner directive 2026-09-26)', async () => {
    const PlainDataTable = DataTable as Component<DataTableProps<Row> & { variant: 'plain' }>;
    const { container, unmount } = render(PlainDataTable, {
      props: { variant: 'plain', data: rows, columns, getRowId: (r: Row) => r.id },
    });
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2);
    });
    expect(container.querySelector('.dt-resize')).toBeTruthy();
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

// ───────────────────────────────────────────────────────────────────────────
// T1 contract (spec 2026-09-28 "One configurable table"): every behaviour a
// consumer used to hand-build is a prop, snippet or bindable, and every default
// reproduces the pre-T1 rendering.
// ───────────────────────────────────────────────────────────────────────────

type WideRow = { id: string; grp: string; name: string; qty: number };
const wideRows: WideRow[] = [
  { id: '1', grp: 'b', name: 'x', qty: 1 },
  { id: '2', grp: 'a', name: 'z', qty: 5 },
  { id: '3', grp: 'a', name: 'y', qty: 3 },
];
const wideColumns: DataColumn<WideRow>[] = [
  { key: 'grp', label: 'Grp' },
  { key: 'name', label: 'Name' },
  { key: 'qty', label: 'Qty', numeric: true },
];
/* eslint-disable @typescript-eslint/no-explicit-any */
const AnyDataTable = DataTable as Component<any>;
const mountWide = async (props: Record<string, unknown> = {}) => {
  const r = render(AnyDataTable, {
    props: {
      data: wideRows,
      columns: wideColumns,
      getRowId: (row: WideRow) => row.id,
      ...props,
    },
  });
  await waitFor(() =>
    expect(r.container.querySelectorAll('tbody tr[data-row-index]').length).toBeGreaterThan(0),
  );
  return r;
};
const colTexts = (c: HTMLElement, key: string) =>
  [...c.querySelectorAll(`tbody tr[data-row-index] td[data-col="${key}"]`)].map((td) =>
    td.textContent?.trim(),
  );
const root = (c: HTMLElement) => c.querySelector<HTMLElement>('.dt-root')!;
/** happy-dom re-serializes inline styles with spaces — compare without them. */
const styleOf = (el: Element) => (el.getAttribute('style') ?? '').replace(/\s+/g, '');

describe('T1 · per-row actions', () => {
  const actionSnippet = createRawSnippet<[WideRow]>(() => ({
    render: () => `<button type="button" data-testid="row-action">Go</button>`,
    setup: () => {},
  }));

  it('renders one sticky actions cell per row and never leaks its clicks to onRowClick', async () => {
    const rowClicks: string[] = [];
    const { container, unmount } = await mountWide({
      rowActions: actionSnippet,
      onRowClick: (row: WideRow) => rowClicks.push(row.id),
    });
    const actions = container.querySelectorAll('tbody td.dt-act [data-testid="row-action"]');
    expect(actions.length).toBe(wideRows.length);
    // The header keeps a matching cell so the column stays aligned.
    expect(container.querySelector('thead th.dt-act')).toBeTruthy();

    await fireEvent.click(actions[0]);
    expect(rowClicks).toEqual([]);
    // ...while the row itself still reports a click.
    await fireEvent.click(container.querySelector('tbody tr[data-row-index] td[data-col="name"]')!);
    expect(rowClicks).toEqual(['1']);
    unmount();
    cleanup();
  });

  it('hides the actions until hover by default and keeps them visible with rowActionsMode="always"', async () => {
    const hover = await mountWide({ rowActions: actionSnippet });
    expect(root(hover.container).classList.contains('dt-actions-always')).toBe(false);
    hover.unmount();
    cleanup();
    const always = await mountWide({ rowActions: actionSnippet, rowActionsMode: 'always' });
    expect(root(always.container).classList.contains('dt-actions-always')).toBe(true);
    always.unmount();
    cleanup();
  });
});

describe('T1 · row styling', () => {
  it('applies rowClass and rowStyle to the <tr>', async () => {
    const { container, unmount } = await mountWide({
      rowClass: (row: WideRow) => (row.grp === 'a' ? 'sev-high' : undefined),
      rowStyle: (row: WideRow) => (row.id === '1' ? 'opacity:0.5' : undefined),
    });
    const rows = [...container.querySelectorAll<HTMLElement>('tbody tr[data-row-index]')];
    expect(rows.map((tr) => tr.classList.contains('sev-high'))).toEqual([false, true, true]);
    expect(styleOf(rows[0])).toContain('opacity:0.5');
    unmount();
    cleanup();
  });
});

describe('T1 · loading and error states', () => {
  it('renders loadingRows skeleton rows instead of the empty state', async () => {
    const six = render(AnyDataTable, {
      props: { data: [], columns: wideColumns, getRowId: (r: WideRow) => r.id, loading: true },
    });
    await waitFor(() => expect(six.container.querySelectorAll('.dt-skeleton-row').length).toBe(6));
    six.unmount();
    cleanup();

    const three = render(AnyDataTable, {
      props: {
        data: [],
        columns: wideColumns,
        getRowId: (r: WideRow) => r.id,
        loading: true,
        loadingRows: 3,
      },
    });
    await waitFor(() =>
      expect(three.container.querySelectorAll('.dt-skeleton-row').length).toBe(3),
    );
    expect(three.container.querySelector('table')).toBeNull();
    three.unmount();
    cleanup();
  });

  it('renders the error message and a retry button instead of rows', async () => {
    const retries: number[] = [];
    const { container, getByRole, unmount } = render(AnyDataTable, {
      props: {
        data: wideRows,
        columns: wideColumns,
        getRowId: (r: WideRow) => r.id,
        error: new Error('gateway unreachable'),
        onRetry: () => retries.push(1),
      },
    });
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('gateway unreachable');
    expect(container.querySelector('tbody')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Retry' }));
    expect(retries).toEqual([1]);
    unmount();
    cleanup();
  });
});

describe('T1 · geometry', () => {
  it('density drives --dt-row-h and its own padding class', async () => {
    for (const [density, px, cls] of [
      ['compact', '36px', 'dt-compact'],
      ['normal', '44px', ''],
      ['comfortable', '52px', 'dt-comfortable'],
    ] as const) {
      const { container, unmount } = await mountWide({ density });
      expect(styleOf(root(container))).toContain(`--dt-row-h:${px}`);
      if (cls) expect(root(container).classList.contains(cls)).toBe(true);
      unmount();
      cleanup();
    }
  });

  it('a CSS length height becomes a fixed scroll pane; fit/fill keep their presets', async () => {
    const fixed = await mountWide({ height: '22rem' });
    expect(styleOf(root(fixed.container))).toContain('height:22rem');
    expect(root(fixed.container).classList.contains('dt-plain')).toBe(false);
    expect(fixed.container.querySelector('.dt-scroll')!.classList.contains('overflow-auto')).toBe(
      true,
    );
    fixed.unmount();
    cleanup();

    const fit = await mountWide({ height: 'fit' });
    expect(root(fit.container).classList.contains('dt-plain')).toBe(true);
    fit.unmount();
    cleanup();
  });

  it('freezes exactly the first stickyColumns data columns', async () => {
    const { container, unmount } = await mountWide({ stickyColumns: 2 });
    // NOT `:first-of-type` — the virtualizer's leading spacer <tr> is the tbody's
    // first row and carries no data-row-index.
    const firstRow = container.querySelector('tbody tr[data-row-index]')!;
    const cells = [...firstRow.querySelectorAll('td')];
    expect(cells.slice(0, 3).map((td) => td.classList.contains('dt-frozen'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(cells[1].classList.contains('dt-frozen-last')).toBe(true);
    // Offsets are cumulative over the preceding frozen widths.
    expect(styleOf(cells[0])).toContain('left:0px');
    expect(styleOf(cells[1])).toContain('left:220px');
    expect(root(container).classList.contains('dt-has-sticky')).toBe(true);
    unmount();
    cleanup();
  });
});

describe('T1 · chrome decomposition', () => {
  it('a chrome array keeps only the affordances it lists', async () => {
    const { container, unmount } = await mountWide({ chrome: ['search'], onAdd: () => {} });
    expect(container.querySelector('.dt-search')).toBeTruthy();
    expect(container.querySelector('[aria-label="Columns"]')).toBeNull();
    expect(container.querySelector('[aria-label="Export"]')).toBeNull();
    expect(container.querySelector('[aria-label="Add"]')).toBeNull();
    unmount();
    cleanup();
  });

  it('chrome={false} strips the toolbar, and an explicit per-item prop still wins', async () => {
    const off = await mountWide({ chrome: false });
    expect(off.container.querySelector('.dt-toolbar')).toBeNull();
    off.unmount();
    cleanup();

    const override = await mountWide({ chrome: false, searchable: true });
    expect(override.container.querySelector('.dt-search')).toBeTruthy();
    override.unmount();
    cleanup();
  });

  it('a plain table with a fixed height virtualizes, a plain one without does not', async () => {
    createVirtualizerSpy.mockClear();
    const plain = await mountWide({ variant: 'plain' });
    expect(createVirtualizerSpy).not.toHaveBeenCalled();
    plain.unmount();
    cleanup();

    createVirtualizerSpy.mockClear();
    const sized = await mountWide({ variant: 'plain', height: '20rem' });
    expect(createVirtualizerSpy).toHaveBeenCalledTimes(1);
    sized.unmount();
    cleanup();
  });
});

describe('T1 · multi-sort', () => {
  const clickHeader = async (c: HTMLElement, label: string, shiftKey = false) => {
    const th = [...c.querySelectorAll<HTMLElement>('thead th')].find((el) =>
      el.textContent?.includes(label),
    )!;
    await fireEvent.click(th.querySelector('.sort-h')!, { shiftKey });
  };

  it('Shift+click appends a tie-breaker once maxSort > 1', async () => {
    const { container, unmount } = await mountWide({ maxSort: 2 });
    await clickHeader(container, 'Grp');
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['z', 'y', 'x']));
    await clickHeader(container, 'Name', true);
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['y', 'z', 'x']));
    unmount();
    cleanup();
  });

  it('with the default maxSort of 1 a Shift+click REPLACES the sort', async () => {
    const { container, unmount } = await mountWide();
    await clickHeader(container, 'Grp');
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['z', 'y', 'x']));
    await clickHeader(container, 'Name', true);
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['x', 'y', 'z']));
    unmount();
    cleanup();
  });
});

describe('T1 · filter kinds and chips', () => {
  const textColumns: DataColumn<WideRow>[] = [
    { key: 'grp', label: 'Grp', filter: { options: () => [{ value: 'a', label: 'Ay' }] } },
    { key: 'name', label: 'Name', filter: { kind: 'text' } },
    { key: 'qty', label: 'Qty', numeric: true, filter: { kind: 'number' } },
  ];

  it('a text filter narrows the view case-insensitively', async () => {
    const { container, unmount } = await mountWide({
      columns: textColumns,
      filters: { name: { kind: 'text', text: 'Z' } },
    });
    expect(colTexts(container, 'name')).toEqual(['z']);
    unmount();
    cleanup();
  });

  it('a number filter is an INCLUSIVE min/max range', async () => {
    const { container, unmount } = await mountWide({
      columns: textColumns,
      filters: { qty: { kind: 'number', min: 3, max: 5 } },
    });
    expect(colTexts(container, 'qty').sort()).toEqual(['3', '5']);
    unmount();
    cleanup();
  });

  it('renders one removable chip per active filter, plus Clear all', async () => {
    const { container, unmount } = await mountWide({
      columns: textColumns,
      filters: {
        grp: { kind: 'enum', values: ['a'] },
        name: { kind: 'text', text: 'z' },
      },
    });
    const bar = container.querySelector('.dt-chips')!;
    expect(bar).toBeTruthy();
    const chips = [...bar.querySelectorAll('.chip')];
    expect(chips.length).toBe(2);
    // The enum chip resolves its option LABEL, not the stored value.
    expect(chips[0].textContent).toContain('Ay');
    expect(chips[1].textContent).toContain('z');

    // Removing one chip drops only that filter.
    await fireEvent.click(chips[1].querySelector('button')!);
    await waitFor(() => expect(container.querySelectorAll('.dt-chips .chip').length).toBe(1));
    expect(colTexts(container, 'name').sort()).toEqual(['y', 'z']);

    // Clear all empties the bar entirely.
    const clear = [...container.querySelectorAll<HTMLElement>('.dt-chips button')].find((b) =>
      b.textContent?.includes('Clear all'),
    )!;
    await fireEvent.click(clear);
    await waitFor(() => expect(container.querySelector('.dt-chips')).toBeNull());
    expect(colTexts(container, 'name').length).toBe(3);
    unmount();
    cleanup();
  });

  it('filterChips={false} suppresses the bar while the filter stays live', async () => {
    const { container, unmount } = await mountWide({
      columns: textColumns,
      filterChips: false,
      filters: { name: { kind: 'text', text: 'z' } },
    });
    expect(container.querySelector('.dt-chips')).toBeNull();
    expect(colTexts(container, 'name')).toEqual(['z']);
    unmount();
    cleanup();
  });
});

describe('T1 · groupBy', () => {
  it('synthesizes a labelled parent row per bucket and nests its rows under it', async () => {
    const { container, unmount } = await mountWide({
      groupBy: {
        of: (row: WideRow) => row.grp,
        label: (key: string, rows: WideRow[]) => `G-${key} (${rows.length})`,
      },
    });
    const groups = [...container.querySelectorAll('tbody tr.dt-group-row')];
    expect(groups.length).toBe(2);
    expect(groups[0].textContent).toContain('G-b (1)');
    expect(groups[1].textContent).toContain('G-a (2)');
    // Groups open by default, so every record row is still rendered...
    expect(colTexts(container, 'name').length).toBe(3);
    // ...and a group header is NOT a record row (no roving-focus index on it).
    expect(groups[0].hasAttribute('data-row-index')).toBe(false);

    // Collapsing a group removes only its rows.
    await fireEvent.click(groups[0].querySelector('.dt-exp')!);
    await waitFor(() => expect(colTexts(container, 'name').length).toBe(2));
    unmount();
    cleanup();
  });

  it('collapsed: true starts every group closed', async () => {
    const { container, unmount } = render(AnyDataTable, {
      props: {
        data: wideRows,
        columns: wideColumns,
        getRowId: (row: WideRow) => row.id,
        groupBy: { of: (row: WideRow) => row.grp, collapsed: true },
      },
    });
    await waitFor(() => expect(container.querySelectorAll('tbody tr.dt-group-row').length).toBe(2));
    expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(0);
    unmount();
    cleanup();
  });
});

describe('T1 · footer row', () => {
  it('renders the SAME per-column aggregate the header shows', async () => {
    localStorage.setItem('dt:t1-footer', JSON.stringify({ aggregates: { qty: ['sum'] } }));
    const { container, unmount } = await mountWide({ storageKey: 't1-footer', footer: true });
    await waitFor(() => expect(container.querySelector('tfoot')).toBeTruthy());
    const headerAgg = container
      .querySelector('thead th[data-col="qty"] .dt-agg')!
      .textContent?.trim();
    const footerAgg = container
      .querySelector('tfoot td[data-foot-col="qty"] .dt-foot-val')!
      .textContent?.trim();
    expect(headerAgg).toBe('9');
    expect(footerAgg).toBe(headerAgg);
    // A column with no active aggregate stays blank rather than repeating a total.
    expect(container.querySelector('tfoot td[data-foot-col="name"]')!.textContent?.trim()).toBe('');
    unmount();
    cleanup();
    localStorage.removeItem('dt:t1-footer');
  });

  it('footer defaults off, so an existing table grows no extra row', async () => {
    const { container, unmount } = await mountWide();
    expect(container.querySelector('tfoot')).toBeNull();
    unmount();
    cleanup();
  });
});

describe('T1 · per-column snippets', () => {
  it('the cells record wins over the single cell snippet and needs no custom flag', async () => {
    const perColumn = createRawSnippet<[WideRow, DataColumn<WideRow>, { canEdit: boolean }]>(
      (row) => ({
        render: () => `<span data-testid="per-col">P:${row().name}</span>`,
        setup: () => {},
      }),
    );
    const fallback = createRawSnippet<[WideRow, DataColumn<WideRow>, { canEdit: boolean }]>(() => ({
      render: () => `<span data-testid="fallback">F</span>`,
      setup: () => {},
    }));
    const { container, unmount } = await mountWide({
      columns: [
        { key: 'grp', label: 'Grp' },
        { key: 'name', label: 'Name', custom: true },
      ],
      cells: { name: perColumn },
      cell: fallback,
    });
    expect(container.querySelectorAll('[data-testid="per-col"]').length).toBe(3);
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull();
    expect(colTexts(container, 'name')).toEqual(['P:x', 'P:z', 'P:y']);
    unmount();
    cleanup();
  });

  it('a headers record replaces one column header', async () => {
    const customHeader = createRawSnippet<[DataColumn<WideRow>]>((col) => ({
      render: () => `<span data-testid="hdr">H:${col().key}</span>`,
      setup: () => {},
    }));
    const { container, unmount } = await mountWide({ headers: { qty: customHeader } });
    expect(container.querySelector('[data-testid="hdr"]')!.textContent).toBe('H:qty');
    unmount();
    cleanup();
  });
});

describe('T1 · root passthrough', () => {
  it('forwards class, style and unknown attributes to the root element', async () => {
    const { container, unmount } = await mountWide({
      class: 'my-table',
      style: 'border:1px solid red',
      'data-testid': 'root-passthrough',
      'aria-label': 'Wide rows',
    });
    const el = root(container);
    expect(el.classList.contains('my-table')).toBe(true);
    expect(styleOf(el)).toContain('border:1pxsolidred');
    expect(el.getAttribute('data-testid')).toBe('root-passthrough');
    expect(el.getAttribute('aria-label')).toBe('Wide rows');
    unmount();
    cleanup();
  });
});

describe('T1 · seeded sort/filter survive a data refresh', () => {
  // `sort` and `filters` became BINDABLE props in T1. Reading a prop subscribes
  // to the props signal, so a plain data refresh re-runs anything that reads
  // them — the seeded selection must not be rebuilt from `initialSort`/
  // `initialFilters` on every refresh (that would silently un-filter the table
  // under the user mid-task).
  it('keeps the seeded filter and sort across a data refresh', async () => {
    const { container, rerender, unmount } = render(AnyDataTable, {
      props: {
        data: wideRows,
        columns: [
          { key: 'grp', label: 'Grp', filter: { options: () => [{ value: 'a', label: 'Ay' }] } },
          { key: 'name', label: 'Name' },
        ],
        getRowId: (row: WideRow) => row.id,
        initialFilters: { grp: ['a'] },
        initialSort: { key: 'name', dir: 'desc' },
      },
    });
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['z', 'y']));
    await rerender({ data: [...wideRows, { id: '4', grp: 'b', name: 'w', qty: 2 }] });
    await waitFor(() => expect(colTexts(container, 'name')).toEqual(['z', 'y']));
    expect(container.querySelectorAll('.dt-chips .chip').length).toBe(1);
    unmount();
    cleanup();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bundle A (spec 2026-09-28 "table open modes + bulk bar"): record open mode
// wiring, default row-open, and the floating bulk bar that replaced the old
// toolbar kebab.
// ───────────────────────────────────────────────────────────────────────────

type OpenRow = { id: string; name: string; other: string };
const openRows: OpenRow[] = [
  { id: '1', name: 'Alpha', other: 'x' },
  { id: '2', name: 'Beta', other: 'y' },
];
const openColumns: DataColumn<OpenRow>[] = [
  { key: 'name', label: 'Name' },
  { key: 'other', label: 'Other' },
];
const OpenDataTable = DataTable as Component<
  DataTableProps<OpenRow> & {
    titleColumn?: { key: string; href: (r: OpenRow) => string };
    openIn?: 'page' | 'modal' | 'tray';
    onRowClick?: (row: OpenRow) => void;
  }
>;
const otherCellOf = (c: HTMLElement, row: number) =>
  c.querySelector(`tbody tr[data-row-index="${row}"] td[data-col="other"]`)!;

describe('Bundle A · record open mode wiring', () => {
  it('resolves the mode and wires it into the title link and open affordance', async () => {
    peekClickCalls.length = 0;
    openRecordCalls.length = 0;
    const { container, unmount } = render(OpenDataTable, {
      props: {
        data: openRows,
        columns: openColumns,
        getRowId: (r) => r.id,
        titleColumn: { key: 'name', href: (r) => `/stock/items/${r.id}` },
        openIn: 'modal',
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2),
    );
    const nameCell = container.querySelector('tbody tr[data-row-index="0"] td[data-col="name"]')!;
    await fireEvent.click(nameCell.querySelector('a.dt-title-link')!);
    await fireEvent.click(nameCell.querySelector('a.dt-open')!);
    expect(peekClickCalls).toEqual([
      ['/stock/items/1', 'modal'],
      ['/stock/items/1', 'modal'],
    ]);
    // Anchor clicks bubble to the row handler too — it must not ALSO call
    // openRecord (that would open the same record twice).
    expect(openRecordCalls).toEqual([]);
    unmount();
    cleanup();
  });

  it('a plain row click (rowOpen default) opens the title href via openRecord — but onRowClick wins when given', async () => {
    openRecordCalls.length = 0;
    const { container, unmount } = render(OpenDataTable, {
      props: {
        data: openRows,
        columns: openColumns,
        getRowId: (r) => r.id,
        titleColumn: { key: 'name', href: (r) => `/stock/items/${r.id}` },
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2),
    );
    await fireEvent.click(otherCellOf(container, 1));
    expect(openRecordCalls).toEqual([['/stock/items/2', 'page']]);
    unmount();
    cleanup();

    openRecordCalls.length = 0;
    const rowClicks: string[] = [];
    const { container: c2, unmount: u2 } = render(OpenDataTable, {
      props: {
        data: openRows,
        columns: openColumns,
        getRowId: (r) => r.id,
        titleColumn: { key: 'name', href: (r) => `/stock/items/${r.id}` },
        onRowClick: (row) => rowClicks.push(row.id),
      },
    });
    await waitFor(() => expect(c2.querySelectorAll('tbody tr[data-row-index]').length).toBe(2));
    await fireEvent.click(otherCellOf(c2, 1));
    expect(rowClicks).toEqual(['2']);
    expect(openRecordCalls).toEqual([]);
    u2();
    cleanup();
  });
});

describe('Bundle A · floating bulk bar', () => {
  type BulkRow = { id: string; name: string; qty: number };
  const bulkRows: BulkRow[] = [
    { id: '1', name: 'a', qty: 1 },
    { id: '2', name: 'b', qty: 2 },
  ];
  const bulkColumns: DataColumn<BulkRow>[] = [
    { key: 'name', label: 'Name', editable: true },
    { key: 'qty', label: 'Qty', editable: true, type: 'number' },
  ];
  const BulkDataTable = DataTable as Component<
    DataTableProps<BulkRow> & {
      selectable?: boolean;
      selectedIds?: Set<string>;
      onSelectionChange?: (ids: Set<string>, rows: BulkRow[]) => void;
      onSaveRow?: (row: BulkRow, draft: Record<string, string>) => Promise<boolean>;
      bulkActions?: { label: string; danger?: boolean; onSelect: () => void }[];
    }
  >;

  it('replaces the toolbar kebab: shows count, danger-last actions, and an Edit property trigger; Clear empties the selection', async () => {
    const onSelectionChange = vi.fn();
    const bulkActions = [
      { label: 'Archive', onSelect: vi.fn() },
      { label: 'Delete', danger: true, onSelect: vi.fn() },
    ];
    const { container, unmount } = render(BulkDataTable, {
      props: {
        data: bulkRows,
        columns: bulkColumns,
        getRowId: (r) => r.id,
        selectable: true,
        selectedIds: new Set(['1', '2']),
        onSelectionChange,
        onSaveRow: vi.fn(async () => true),
        bulkActions,
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2),
    );
    // No more kebab: bulk actions never render inside the toolbar any more.
    expect(container.querySelector('.dt-toolbar .bulk-item')).toBeNull();
    const bar = container.querySelector('.dt-bulk-bar')!;
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain('2 selected');
    expect(bar.textContent).toContain('Edit property');
    const actionButtons = [...bar.querySelectorAll<HTMLElement>('.dt-bulk-item')];
    expect(actionButtons.map((b) => b.textContent?.trim())).toEqual(['Archive', 'Delete']);
    expect(actionButtons[0].classList.contains('danger')).toBe(false);
    expect(actionButtons[1].classList.contains('danger')).toBe(true);

    await fireEvent.click(bar.querySelector<HTMLElement>('.dt-bulk-clear')!);
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(), []);
    unmount();
    cleanup();
  });

  it('hides Edit property when the table has no onSaveRow, and hides the whole bar with nothing selected', async () => {
    const { container, unmount } = render(BulkDataTable, {
      props: {
        data: bulkRows,
        columns: bulkColumns,
        getRowId: (r) => r.id,
        selectable: true,
        selectedIds: new Set(['1']),
        bulkActions: [{ label: 'Archive', onSelect: vi.fn() }],
      },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2),
    );
    expect(container.querySelector('.dt-bulk-bar')!.textContent).not.toContain('Edit property');
    unmount();
    cleanup();

    const { container: c2, unmount: u2 } = render(BulkDataTable, {
      props: {
        data: bulkRows,
        columns: bulkColumns,
        getRowId: (r) => r.id,
        selectable: true,
        selectedIds: new Set<string>(),
        bulkActions: [{ label: 'Archive', onSelect: vi.fn() }],
      },
    });
    await waitFor(() => expect(c2.querySelectorAll('tbody tr[data-row-index]').length).toBe(2));
    expect(c2.querySelector('.dt-bulk-bar')).toBeNull();
    u2();
    cleanup();
  });
});

describe('DataTable trailing add-column cell + table options popover (spec 2026-09-29 table-toolbar)', () => {
  type OptRow = { id: string; name: string };
  const optRows: OptRow[] = [{ id: '1', name: 'Alpha' }];
  const optColumns: DataColumn<OptRow>[] = [{ key: 'name', label: 'Name' }];
  function bundle(canManage: boolean) {
    return { definitions: [], values: {}, recordAccess: {}, canManage, canEdit: true };
  }
  const CustomDataTable = DataTable as Component<
    DataTableProps<OptRow> & {
      tableId?: string;
      customProperties?: {
        scopeKey: string;
        bundle: ReturnType<typeof bundle>;
        recordId: (row: OptRow) => string | null;
      };
    }
  >;
  async function mountOpt(extra: Record<string, unknown> = {}) {
    const r = render(CustomDataTable, {
      props: {
        data: optRows,
        columns: optColumns,
        getRowId: (row) => row.id,
        tableId: 'stock.items',
        ...extra,
      },
    });
    await waitFor(() =>
      expect(r.container.querySelectorAll('tbody tr[data-row-index]').length).toBe(1),
    );
    return r;
  }

  it('is the last th/td when the viewer can manage custom properties', async () => {
    const { container, unmount } = await mountOpt({
      customProperties: {
        scopeKey: 'org:stock.items',
        bundle: bundle(true),
        recordId: (row: OptRow) => row.id,
      },
    });
    const headerCells = [...container.querySelectorAll('thead th')];
    expect(headerCells.at(-1)?.classList.contains('dt-add-col')).toBe(true);
    expect(headerCells.at(-1)?.textContent).toContain('Add column');
    const bodyCells = [...container.querySelectorAll('tbody tr[data-row-index="0"] > td')];
    expect(bodyCells.at(-1)?.classList.contains('dt-add-col')).toBe(true);
    expect(bodyCells.at(-1)?.textContent?.trim()).toBe('');
    unmount();
    cleanup();
  });

  it('is absent without manage access, and the toolbar no longer has a standalone "+ Add column" button', async () => {
    const { container, unmount } = await mountOpt({
      customProperties: {
        scopeKey: 'org:stock.items',
        bundle: bundle(false),
        recordId: (row: OptRow) => row.id,
      },
    });
    expect(container.querySelector('.dt-add-col')).toBeNull();
    expect(container.querySelector('.dt-toolbar .dt-custom-add')).toBeNull();
    expect(container.querySelector('.dt-toolbar')?.textContent).not.toContain('Add column');
    unmount();
    cleanup();
  });

  it('⚙ opens a "Table options" popover with Open records in; the column menu keeps only visibility + reorder', async () => {
    const { container, unmount } = await mountOpt();
    const optTrigger = container.querySelector('.dt-opt-trig')?.closest('button') as HTMLElement;
    expect(optTrigger).toBeTruthy();
    expect(optTrigger.getAttribute('aria-expanded')).not.toBe('true');
    await fireEvent.click(optTrigger);
    expect(optTrigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.textContent).toContain('Table options');
    expect(document.body.textContent).toContain('Open records in');

    const colsTrigger = [...container.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.includes('Columns'),
    ) as HTMLElement;
    expect(colsTrigger).toBeTruthy();
    await fireEvent.click(colsTrigger);
    const colMenu = container.querySelector('.col-menu');
    expect(colMenu).toBeTruthy();
    expect(colMenu?.textContent).not.toContain('Open records in');
    unmount();
    cleanup();
  });
});
