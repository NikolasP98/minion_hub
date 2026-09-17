// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { createRawSnippet, type Component } from 'svelte';
import { Button } from '@minion-stack/ui';

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
vi.mock('$lib/virtual/virtualizer.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/virtual/virtualizer.svelte')>();
  return {
    ...actual,
    createVirtualizer: (...args: Parameters<typeof actual.createVirtualizer>) => {
      createVirtualizerSpy(...args);
      return actual.createVirtualizer(...args);
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

describe('DataTable sticky actions column is the true last cell (regression 2026-09-16)', () => {
  // Root cause: the trailing spacer `<col>`/`<td>` (absorbs leftover width
  // when the table is narrower than the pane) rendered AFTER the sticky
  // actions cell, so `position: sticky; right: 0` pinned the actions column
  // to a spot short of the table's real right edge — covering the last data
  // column(s) instead of sitting flush past them. Fixed by rendering the
  // spacer before the actions `<col>`/`<th>`/`<td>` so actions is always the
  // last cell of every row (and header) whenever `onSaveRow` makes it
  // present.
  type EditRow = { id: string; name: string; qty: number };
  const editColumns: DataColumn<EditRow>[] = [
    { key: 'name', label: 'Name' },
    { key: 'qty', label: 'Qty', align: 'right' },
  ];
  const editRows: EditRow[] = [{ id: '1', name: 'Widget', qty: 3 }];

  it('renders the actions cell as the last <td> in the header and every body row', async () => {
    const EditDataTable = DataTable as Component<
      DataTableProps<EditRow> & { onSaveRow: (row: EditRow, draft: unknown) => Promise<boolean> }
    >;
    const { container, unmount } = render(EditDataTable, {
      props: {
        data: editRows,
        columns: editColumns.map((c) => ({ ...c, editable: true })),
        getRowId: (r: EditRow) => r.id,
        onSaveRow: vi.fn(async () => true),
      },
    });

    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(1);
    });

    const headerCells = container.querySelectorAll('thead tr th');
    expect(headerCells[headerCells.length - 1]?.classList.contains('dt-actions-cell')).toBe(true);

    const bodyCells = container.querySelectorAll('tbody tr[data-row-index] td');
    expect(bodyCells[bodyCells.length - 1]?.classList.contains('dt-actions-cell')).toBe(true);

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
