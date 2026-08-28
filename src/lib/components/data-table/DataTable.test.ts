// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
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

// Testing Library cannot infer a concrete type argument from a generic Svelte
// component import, so bind the fixture's Row contract at this test boundary.
const RowDataTable = DataTable as Component<DataTableProps<Row>>;
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
