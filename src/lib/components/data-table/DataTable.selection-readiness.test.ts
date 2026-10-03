// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { Component } from 'svelte';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: DataTable } = await import('./DataTable.svelte');
const { default: SelectionFixture } = await import('./DataTable.selection.fixture.svelte');
type DataColumn<T> = import('./DataTable.svelte').DataColumn<T>;
type ServerMode = import('./DataTable.svelte').ServerMode;
type BulkAction<T> = import('./DataTable.svelte').BulkAction<T>;

type Row = { id: string; name: string };
type Props = {
  data: Row[];
  columns: DataColumn<Row>[];
  getRowId: (row: Row) => string;
  selectable: boolean;
  searchable?: boolean;
  variant: 'plain';
  onSelectionChange?: (ids: Set<string>, rows: Row[]) => void;
  server?: ServerMode;
  onSaveRow?: (row: Row, draft: Partial<Row>) => Promise<boolean>;
  bulkActions?: BulkAction<Row>[];
  tagScope?: 'stock';
  tagsOf?: (row: Row) => string[];
};

const Table = DataTable as Component<Props>;
const rows: Row[] = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
];
const columns: DataColumn<Row>[] = [{ key: 'name', label: 'Name', editable: true }];
const base = {
  columns,
  getRowId: (row: Row) => row.id,
  selectable: true,
  variant: 'plain' as const,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DataTable selection readiness', () => {
  it('removes an ordinary selected id when a replacement projection no longer contains it', async () => {
    const changes: string[][] = [];
    render(SelectionFixture, {
      props: {
        onchange: (ids: Set<string>) => changes.push([...ids]),
      },
    });

    const firstRow = screen.getAllByRole('checkbox', { name: 'select row' })[0];
    expect(firstRow.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(firstRow);
    await waitFor(() => expect(firstRow.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(changes.at(-1)).toEqual(['1']));

    await fireEvent.click(screen.getByRole('button', { name: 'Replace projection' }));
    await waitFor(() => expect(changes.at(-1)).toEqual([]));
  });

  it('removes an ordinary selected id when a local filter hides its row', async () => {
    const changes: string[][] = [];
    render(SelectionFixture, {
      props: {
        onchange: (ids: Set<string>) => changes.push([...ids]),
      },
    });

    const firstRow = screen.getAllByRole('checkbox', { name: 'select row' })[0];
    await fireEvent.click(firstRow);
    await waitFor(() => expect(firstRow.getAttribute('aria-checked')).toBe('true'));
    await waitFor(() => expect(changes.at(-1)).toEqual(['1']));
    await fireEvent.input(screen.getByPlaceholderText(/search/i), {
      target: { value: 'Beta' },
    });

    await waitFor(() => expect(changes.at(-1)).toEqual([]));
  });

  it('clears an ordinary selection before emitting a new server query', async () => {
    const events: string[] = [];
    const server: ServerMode = {
      total: rows.length,
      onQuery: () => events.push('query'),
    };
    render(Table, {
      props: {
        ...base,
        data: rows,
        server,
        onSelectionChange: (ids) => events.push(`selection:${[...ids].join(',')}`),
      },
    });

    const firstRow = screen.getAllByRole('checkbox', { name: 'select row' })[0];
    await fireEvent.click(firstRow);
    await waitFor(() => expect(firstRow.getAttribute('aria-checked')).toBe('true'));
    await fireEvent.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() => expect(events).toContain('query'));
    expect(events.indexOf('selection:')).toBeGreaterThan(events.indexOf('selection:1'));
    expect(events.indexOf('selection:')).toBeLessThan(events.indexOf('query'));
  });

  it('discloses hidden all-matching ids and disables row-data bulk edit', async () => {
    const server: ServerMode = {
      total: 3,
      onQuery: vi.fn(),
      onSelectAllMatching: async () => ['1', '2', '3'],
    };
    render(Table, {
      props: {
        ...base,
        data: [{ id: '1', name: 'Alpha' }],
        server,
        onSaveRow: async () => true,
        bulkActions: [{ label: 'Archive', onSelect: vi.fn() }],
      },
    });

    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    expect(selectAll.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(selectAll);
    await fireEvent.click(screen.getByRole('button', { name: /select all 3 matching/i }));

    await waitFor(() =>
      expect(screen.getAllByText(/3 selected \(2 not visible\)/i).length).toBeGreaterThan(0),
    );
    await fireEvent.click(screen.getByRole('button', { name: /edit property/i }));
    expect(
      screen.getByText(/edit and tag actions require every selected row to be visible/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^apply$/i }).hasAttribute('disabled')).toBe(true);
  });

  it('ignores all-matching ids resolved for a stale query generation', async () => {
    let resolveIds!: (ids: string[]) => void;
    const changes: string[][] = [];
    const server: ServerMode = {
      total: 3,
      onQuery: vi.fn(),
      onSelectAllMatching: () =>
        new Promise<string[]>((resolve) => {
          resolveIds = resolve;
        }),
    };
    render(Table, {
      props: {
        ...base,
        searchable: true,
        data: rows,
        server,
        onSelectionChange: (ids) => changes.push([...ids]),
      },
    });

    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    expect(selectAll.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(selectAll);
    await fireEvent.click(screen.getByRole('button', { name: /select all 3 matching/i }));
    await fireEvent.input(screen.getByPlaceholderText(/search/i), {
      target: { value: 'Beta' },
    });
    resolveIds(['1', '2', '3']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(changes.some((ids) => ids.includes('3'))).toBe(false);
  });

  it('drops failed tag retry operations when selection changes in flight', async () => {
    let resolveBulk!: (response: Response) => void;
    const bulkResponse = new Promise<Response>((resolve) => {
      resolveBulk = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/tags?scope=stock') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ tags: [{ id: 't1', name: 'Urgent', color: '#ef4444' }] }),
        } as Response);
      }
      if (url === '/api/tags') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ tag: { id: 't1', name: 'Urgent', color: '#ef4444' } }),
        } as Response);
      }
      if (url === '/api/tags/bulk') return bulkResponse;
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(Table, {
      props: {
        ...base,
        data: rows,
        tagScope: 'stock',
        tagsOf: () => [],
      },
    });

    const rowButtons = screen.getAllByRole('checkbox', { name: 'select row' });
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) => String(input) === '/api/tags?scope=stock'),
      ).toBe(true),
    );
    await fireEvent.click(rowButtons[0]);
    await fireEvent.click(await screen.findByRole('button', { name: /^tags$/i }));
    const listbox = await screen.findByRole('listbox', { name: /^tags$/i });
    await fireEvent.input(within(listbox).getByRole('textbox'), {
      target: { value: 'Urgent' },
    });
    await fireEvent.keyDown(within(listbox).getByRole('textbox'), { key: 'Enter' });
    const apply = screen.getByRole('button', { name: /^apply$/i });
    await vi.waitFor(() => expect(apply.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(apply);
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/tags/bulk')).toBe(true),
    );

    await fireEvent.click(rowButtons[0]);
    resolveBulk(new Response(null, { status: 503 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fireEvent.click(rowButtons[1]);
    await fireEvent.click(await screen.findByRole('button', { name: /^tags$/i }));

    expect(screen.queryByRole('button', { name: /^retry$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^apply$/i }).hasAttribute('disabled')).toBe(true);
  });
});
