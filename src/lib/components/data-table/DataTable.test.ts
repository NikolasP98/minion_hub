// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

// Vitest runs without `globals`, so @testing-library/svelte cannot self-register
// its auto-cleanup hook — unmount every mounted tree here or the next render()
// in this file inherits the previous one's DOM.
afterEach(cleanup);

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

// ── Slice 2 fixtures ────────────────────────────────────────────────────────
// A second column shape that carries BOTH a sortable column and an enum-filter
// column, so one mounted table can drive every server-mode interaction the S4
// DoD names (search / sort / page / filter). A column with `filter` renders a
// ColumnFilter instead of a sort header (see DataTable.svelte's
// `{#if c.filter} … {:else if c.sortable !== false}`), so the two cannot be the
// same column.
type FilterRow = { id: string; name: string; status: string };
const FilterServerDataTable = DataTable as Component<
  DataTableProps<FilterRow> & { server: ServerMode }
>;
const filterColumns: DataColumn<FilterRow>[] = [
  { key: 'name', label: 'Name' },
  {
    key: 'status',
    label: 'Status',
    filter: {
      options: () => [
        { value: 'active', label: 'Active' },
        { value: 'archived', label: 'Archived' },
      ],
    },
  },
];
// Deliberately NOT in ascending name order and deliberately shorter than
// `server.total`: this is one server-ranked page, not the whole set.
const pageRows: FilterRow[] = [
  { id: '2', name: 'Beta', status: 'active' },
  { id: '1', name: 'Alpha', status: 'archived' },
];
const filterRowId = (r: FilterRow) => r.id;
const SERVER_TOTAL = 57;
const SERVER_PAGE_SIZE = 10;

/** Collapse the template whitespace Svelte keeps around interpolated text. */
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('DataTable server mode: pager range/label derive from server.total', () => {
  it('reads server.total, not data.length, and advances the range by pageSize', async () => {
    const onQuery = vi.fn();
    const server: ServerMode = {
      total: SERVER_TOTAL,
      pageSize: SERVER_PAGE_SIZE,
      onQuery,
    };
    const { container, getByRole } = render(FilterServerDataTable, {
      props: { data: pageRows, columns: filterColumns, getRowId: filterRowId, server },
    });

    // The pager label carries no accessible name of its own (it is a plain
    // <span class="dt-count">, the only one rendered in server mode — the
    // client-mode row-count span is in the `{:else}` branch), so it is queried
    // structurally rather than by role.
    const label = () => squash(container.querySelector('.dt-count')?.textContent);

    // 2 loaded rows, 57 server-side: every number below comes from `total`.
    expect(label()).toBe(`1–${SERVER_PAGE_SIZE} / ${SERVER_TOTAL}`);
    expect(label()).not.toContain(String(pageRows.length));

    const prev = getByRole('button', { name: 'Previous page' });
    const next = getByRole('button', { name: 'Next page' });
    expect(prev).toHaveProperty('disabled', true);
    expect(next).toHaveProperty('disabled', false);

    await fireEvent.click(next);
    await waitFor(() => expect(label()).toBe(`11–20 / ${SERVER_TOTAL}`));
    expect(getByRole('button', { name: 'Previous page' })).toHaveProperty('disabled', false);
  });

  it('clamps the last page to server.total and disables next there', async () => {
    const onQuery = vi.fn();
    // 57 rows at 10/page ⇒ 6 pages; page 6 shows 51–57, not 51–60.
    const server: ServerMode = { total: SERVER_TOTAL, pageSize: SERVER_PAGE_SIZE, onQuery };
    const { container, getByRole } = render(FilterServerDataTable, {
      props: { data: pageRows, columns: filterColumns, getRowId: filterRowId, server },
    });
    const label = () => squash(container.querySelector('.dt-count')?.textContent);

    for (let i = 0; i < 5; i++) await fireEvent.click(getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(label()).toBe(`51–${SERVER_TOTAL} / ${SERVER_TOTAL}`));
    expect(getByRole('button', { name: 'Next page' })).toHaveProperty('disabled', true);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: null,
      filters: {},
      page: 6,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('renders an empty range when server.total is 0', () => {
    const server: ServerMode = { total: 0, pageSize: SERVER_PAGE_SIZE, onQuery: vi.fn() };
    const { container } = render(FilterServerDataTable, {
      props: { data: [], columns: filterColumns, getRowId: filterRowId, server },
    });
    expect(squash(container.querySelector('.dt-count')?.textContent)).toBe('0–0 / 0');
  });
});

describe('DataTable server mode: one complete onQuery payload per interaction', () => {
  /**
   * Mount a server-mode table and hand back a call-counter that starts at zero.
   * Documented mount-time behavior: DataTable emits NO query while mounting —
   * the caller already owns page 1 (there is no `$effect` calling
   * `emitServerQuery`; the only callers are setFilter / setSort / toggleSort /
   * emitSearchQuery / goToServerPage / maybeRequestNextPage). That is asserted
   * rather than assumed, so a future mount-time emit shows up here instead of
   * silently absorbing one of the per-interaction deltas below.
   */
  function mountServerTable() {
    const onQuery = vi.fn();
    const server: ServerMode = { total: SERVER_TOTAL, pageSize: SERVER_PAGE_SIZE, onQuery };
    const utils = render(FilterServerDataTable, {
      props: { data: pageRows, columns: filterColumns, getRowId: filterRowId, server },
    });
    expect(onQuery).toHaveBeenCalledTimes(0);
    onQuery.mockClear();
    return { onQuery, ...utils };
  }

  it('search: one debounced query carrying the typed term', async () => {
    const { onQuery, getByPlaceholderText } = mountServerTable();

    await fireEvent.input(getByPlaceholderText('Search…'), { target: { value: 'bet' } });

    // 300 ms debounce in DataTable.svelte's `emitSearchQuery`.
    await waitFor(() => expect(onQuery).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onQuery).toHaveBeenLastCalledWith({
      search: 'bet',
      sort: null,
      filters: {},
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('sort: one query per header click, direction toggling on the second', async () => {
    const { onQuery, getByRole } = mountServerTable();

    await fireEvent.click(getByRole('button', { name: 'Name' }));
    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: { key: 'name', dir: 'asc' },
      filters: {},
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });

    await fireEvent.click(getByRole('button', { name: 'Name' }));
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: { key: 'name', dir: 'desc' },
      filters: {},
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('page: one query per pager click, carrying the new page', async () => {
    const { onQuery, getByRole } = mountServerTable();

    await fireEvent.click(getByRole('button', { name: 'Next page' }));
    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: null,
      filters: {},
      page: 2,
      pageSize: SERVER_PAGE_SIZE,
    });

    await fireEvent.click(getByRole('button', { name: 'Previous page' }));
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: null,
      filters: {},
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('filter: opening the menu emits nothing; picking an option emits one query', async () => {
    const { onQuery, getByRole } = mountServerTable();

    await fireEvent.click(getByRole('button', { name: 'Status' }));
    expect(onQuery).toHaveBeenCalledTimes(0);

    // The options are queried as buttons, not `role="option"`: ColumnFilter.svelte
    // passes `role="option"` / `aria-selected` down to the shared
    // @minion-stack/ui Button, whose <svelte:element> re-declares
    // `role={href && isDisabled ? 'link' : undefined}` AFTER its `{...rest}`
    // spread — an explicit `undefined` wins over the spread, so the role never
    // reaches the DOM and the popup is not an accessible listbox. That is a
    // pre-existing shared-primitive defect (see the run summary); this spec is
    // test-only and may not edit either component, so the test targets the
    // accessible name that IS exposed rather than asserting the broken role.
    await fireEvent.click(getByRole('button', { name: 'Active' }));
    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: null,
      filters: { status: 'active' },
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });

    // Comma-joined multi-select, and still exactly one query for the click.
    await fireEvent.click(getByRole('button', { name: 'Archived' }));
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: null,
      filters: { status: 'active,archived' },
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('a filter/sort change after paging resets the query back to page 1', async () => {
    const { onQuery, getByRole } = mountServerTable();

    await fireEvent.click(getByRole('button', { name: 'Next page' }));
    expect(onQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await fireEvent.click(getByRole('button', { name: 'Name' }));
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith({
      search: '',
      sort: { key: 'name', dir: 'asc' },
      filters: {},
      page: 1,
      pageSize: SERVER_PAGE_SIZE,
    });
  });

  it('server mode renders the page verbatim while the interactions above run', async () => {
    const { getAllByRole, getByRole, container } = mountServerTable();

    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(pageRows.length),
    );
    const names = () =>
      [...container.querySelectorAll('tbody tr[data-row-index] td[data-col="name"]')].map((td) =>
        squash(td.textContent),
      );
    expect(names()).toEqual(['Beta', 'Alpha']);

    // An ascending sort request must NOT reorder the already-ranked page: the
    // caller answers with new `data`, the table does not re-sort locally.
    await fireEvent.click(getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(names()).toEqual(['Beta', 'Alpha']));
    expect(getAllByRole('row').length).toBeGreaterThan(pageRows.length); // header + body
  });
});

/**
 * Strip the only nondeterministic markup DataTable emits under test:
 * Svelte's per-file scoped class hash (`svelte-xxxxxx`, regenerated whenever
 * the component's <style> changes) and any auto-generated element ids. Row
 * order, pager/toolbar text, roles, aria state, data-* attributes, inline
 * widths and virtualizer spacer heights are all left in the snapshot on
 * purpose — they are what the characterization is guarding.
 */
function normalizeDom(container: HTMLElement): string {
  return (
    container.innerHTML
      .replace(/\s*svelte-[a-z0-9]+/g, '')
      // Zag/Tooltip mints ids from a process-wide counter (`tooltip-c13`), so
      // they shift whenever an earlier test in this file mounts one more
      // component. Both the id and every attribute pointing at one are masked.
      .replace(
        /(\sid="|\saria-controls="|\saria-labelledby="|\saria-describedby="|\sdata-ownedby="|\sfor=")[^"]*"/g,
        '$1<id>"',
      )
      .replace(/ class=""/g, '')
      .replace(/></g, '>\n<')
  );
}

describe('DataTable client mode (no server prop) — normalized DOM characterization', () => {
  it('matches the reviewed client-mode snapshot', async () => {
    const { container } = render(RowDataTable, {
      props: { data: rows, columns, getRowId: (r: Row) => r.id },
    });
    await waitFor(() =>
      expect(container.querySelectorAll('tbody tr[data-row-index]').length).toBe(rows.length),
    );
    expect(normalizeDom(container)).toMatchSnapshot();
  });

  it('still sorts, searches and counts locally with no server prop', async () => {
    const { container, getByRole, getByPlaceholderText } = render(RowDataTable, {
      props: { data: [...rows].reverse(), columns, getRowId: (r: Row) => r.id },
    });
    const names = () =>
      [...container.querySelectorAll('tbody tr[data-row-index] td[data-col="name"]')].map((td) =>
        squash(td.textContent),
      );
    await waitFor(() => expect(names()).toEqual(['Beta', 'Alpha']));

    // No `server` prop ⇒ the local pipeline still owns sort…
    await fireEvent.click(getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(names()).toEqual(['Alpha', 'Beta']));

    // …and search, with the count label derived from `data.length`.
    await fireEvent.input(getByPlaceholderText('Search…'), { target: { value: 'alp' } });
    await waitFor(() => expect(names()).toEqual(['Alpha']));
    expect(squash(container.querySelector('.dt-count')?.textContent)).toBe(
      `Showing 1 of ${rows.length}`,
    );
  });
});
