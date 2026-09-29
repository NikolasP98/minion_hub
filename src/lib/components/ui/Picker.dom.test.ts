// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Component } from 'svelte';
import * as m from '$lib/paraglide/messages';
import type { PickerColumn, PickerLoadResult, PickerSelectionMode } from './picker';

// The picker's rows are DataTable's rows since T4 (spec
// 2026-09-28-hub-table-standardization), and DataTable only mounts its row
// virtualizer `if (browser && wrapperEl)` — so `browser` has to be true here for
// any row to exist. File-local override; the rest of the suite keeps the default.
vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: Picker } = await import('./Picker.svelte');

type Row = { id: string; name: string; code: string; meta: string };
type PickerProps = {
  open?: boolean;
  title: string;
  columns: PickerColumn<Row>[];
  rows?: Row[];
  loadRows?: (query: string) => Promise<PickerLoadResult<Row>>;
  getRowId: (row: Row) => string;
  onPick: (row: Row) => void;
  onUnpick?: (row: Row) => void;
  selectionMode?: PickerSelectionMode;
  pickedIds?: ReadonlySet<string>;
  columnsConfigurable?: boolean;
};
const RowPicker = Picker as unknown as Component<PickerProps>;

const columns: PickerColumn<Row>[] = [
  { key: 'name', label: 'Name', priority: 10, emphasis: 'primary', hideable: false },
  { key: 'code', label: 'Code', priority: 20 },
  { key: 'meta', label: 'Meta', priority: 30, defaultHidden: true },
];
const rows: Row[] = [
  { id: 'a', name: 'Alpha', code: 'A-1', meta: 'first' },
  { id: 'b', name: 'Beta', code: 'B-2', meta: 'second' },
];

beforeAll(() => {
  // happy-dom has no layout engine: TanStack Virtual would observe a zero-height
  // viewport and render nothing (same stub as DataTable.test.ts).
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterAll(() => vi.restoreAllMocks());

function mount(props: Partial<PickerProps> = {}) {
  return render(RowPicker, {
    props: {
      open: true,
      title: 'Pick something',
      columns,
      rows,
      getRowId: (row: Row) => row.id,
      onPick: () => {},
      ...props,
    },
  });
}

/** One rendered grid row, by the name cell it shows. */
async function rowByName(name: string): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found =
      [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-index]')].find((tr) =>
        tr.textContent?.includes(name),
      ) ?? null;
    expect(found).toBeTruthy();
  });
  return found!;
}

function actionButton(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('.dt-row-actions button');
  expect(button).toBeTruthy();
  return button!;
}

describe('Picker rows render through DataTable', () => {
  it('renders one grid row per candidate, hiding a defaultHidden column', async () => {
    const { unmount } = mount();
    await rowByName('Alpha');
    await rowByName('Beta');
    const headers = [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(headers).toContain('Name');
    expect(headers).toContain('Code');
    expect(headers).not.toContain('Meta');
    unmount();
    cleanup();
  });

  it('treats a consumer `pickedIds` as authoritative for the picked row treatment', async () => {
    const { unmount } = mount({
      selectionMode: 'multiple',
      pickedIds: new Set(['b']),
      onUnpick: () => {},
    });
    expect((await rowByName('Beta')).className).toContain('picker-row-picked');
    expect((await rowByName('Alpha')).className).not.toContain('picker-row-picked');
    unmount();
    cleanup();
  });

  it('offers ONE verb per row: remove on a picked row, add on the rest — each firing once', async () => {
    const onPick = vi.fn();
    const onUnpick = vi.fn();
    const { unmount } = mount({
      selectionMode: 'multiple',
      pickedIds: new Set(['b']),
      onPick,
      onUnpick,
    });

    const picked = actionButton(await rowByName('Beta'));
    expect(picked.getAttribute('aria-label')).toBe(m.picker_remove_row());
    await fireEvent.click(picked);
    expect(onUnpick).toHaveBeenCalledTimes(1);
    expect(onUnpick.mock.calls[0][0]).toMatchObject({ id: 'b' });
    expect(onPick).not.toHaveBeenCalled();

    const free = actionButton(await rowByName('Alpha'));
    expect(free.getAttribute('aria-label')).toBe(m.picker_pick_row());
    await fireEvent.click(free);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: 'a' });

    unmount();
    cleanup();
  });

  it('keeps a picked row BLOCKED when the form cannot unpick (no `onUnpick`)', async () => {
    const onPick = vi.fn();
    const { unmount } = mount({ selectionMode: 'multiple', pickedIds: new Set(['b']), onPick });
    const blocked = actionButton(await rowByName('Beta'));
    expect(blocked.disabled).toBe(true);
    expect(blocked.getAttribute('aria-label')).toBe(m.picker_already_added());
    await fireEvent.click(blocked);
    expect(onPick).not.toHaveBeenCalled();
    unmount();
    cleanup();
  });

  it('single mode picks and closes the window; multiple mode stays open', async () => {
    const single = vi.fn();
    const first = mount({ selectionMode: 'single', onPick: single });
    await fireEvent.click(actionButton(await rowByName('Alpha')));
    expect(single).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(document.querySelectorAll('tbody tr[data-row-index]').length).toBe(0);
    });
    first.unmount();
    cleanup();

    const multi = vi.fn();
    const second = mount({ selectionMode: 'multiple', onPick: multi });
    await fireEvent.click(actionButton(await rowByName('Alpha')));
    expect(multi).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('tbody tr[data-row-index]').length).toBeGreaterThan(0);
    second.unmount();
    cleanup();
  });

  it('double-clicking a row toggles it once (the picker gesture, not a row click)', async () => {
    const onPick = vi.fn();
    const { unmount } = mount({ selectionMode: 'multiple', onPick });
    const row = await rowByName('Alpha');
    const cell = row.querySelector<HTMLElement>('.dt-cell')!;
    await fireEvent.click(cell);
    expect(onPick).not.toHaveBeenCalled();
    await fireEvent.dblClick(cell);
    expect(onPick).toHaveBeenCalledTimes(1);
    unmount();
    cleanup();
  });

  it("activates the grid's focused row on Enter (the picker keyboard path)", async () => {
    const onPick = vi.fn();
    const { unmount } = mount({ selectionMode: 'multiple', onPick });
    const row = await rowByName('Beta');
    // DataTable's roving focus marks the current row `.focused` and keeps DOM
    // focus on its scroll pane; the picker reads that marker back (its hotkey
    // layer stops propagation, hence the capture-phase listener).
    row.classList.add('focused');
    const pane = document.querySelector<HTMLElement>('.dt-scroll')!;
    await fireEvent.keyDown(pane, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: 'b' });
    unmount();
    cleanup();
  });

  it('async `loadRows` shows the grid loading state, then its rows', async () => {
    let release: (result: Row[]) => void = () => {};
    const loadRows = vi.fn(
      () =>
        new Promise<PickerLoadResult<Row>>((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = mount({ rows: undefined, loadRows });
    await waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
    release(rows);
    await rowByName('Alpha');
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    unmount();
    cleanup();
  });
});
