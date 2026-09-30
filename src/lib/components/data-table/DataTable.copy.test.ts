// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/svelte';
import type { Row } from './DataTable.copy.fixture.svelte';

// Owner directive 2026-09-30: drag/click multi-cell + matrix selection,
// spreadsheet-compatible copy (Ctrl/Cmd+C), a dotted "copied" outline, row
// selection copy (all visible columns), and paste into editable cells.
vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: Harness, rows } = await import('./DataTable.copy.fixture.svelte');

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterAll(() => vi.restoreAllMocks());
afterEach(cleanup);

async function mount(props: Record<string, unknown> = {}) {
  const view = render(Harness, { props });
  await waitFor(() => {
    expect(view.container.querySelectorAll('tbody tr[data-row-index]').length).toBe(rows.length);
  });
  return view;
}

const cellOf = (container: HTMLElement, rowIndex: number, key: string) =>
  container.querySelector<HTMLTableCellElement>(
    `tbody tr[data-row-index="${rowIndex}"] td[data-col="${key}"]`,
  )!;
const scrollEl = (container: HTMLElement) => container.querySelector<HTMLElement>('.dt-scroll')!;
const checkboxOf = (container: HTMLElement, rowIndex: number) =>
  container.querySelector<HTMLElement>(`tbody tr[data-row-index="${rowIndex}"] .dt-check.is-row`)!;

function copyEvent(): { event: ClipboardEvent; data: DataTransfer } {
  const data = new DataTransfer();
  const event = new ClipboardEvent('copy', {
    clipboardData: data,
    cancelable: true,
    bubbles: true,
  });
  return { event, data };
}
function pasteEvent(text: string): ClipboardEvent {
  const data = new DataTransfer();
  data.setData('text/plain', text);
  return new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true });
}

describe('DataTable — drag range select', () => {
  it('drag from (0,0) to (2,1) selects a 3×2 range', async () => {
    const { container, unmount } = await mount();
    const start = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(start, { button: 0, clientX: 0, clientY: 0 });

    const end = cellOf(container, 2, 'qty');
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(end);
    await fireEvent.pointerMove(document, { clientX: 0, clientY: 80 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();

    for (let r = 0; r <= 2; r++) {
      expect(cellOf(container, r, 'name').classList.contains('dt-sel')).toBe(true);
      expect(cellOf(container, r, 'qty').classList.contains('dt-sel')).toBe(true);
      expect(cellOf(container, r, 'active').classList.contains('dt-sel')).toBe(false);
    }
    unmount();
  });

  it('a plain click (no drag) on a row with onRowClick still fires the row click after selecting the cell', async () => {
    const rowClicks: string[] = [];
    const { container, unmount } = await mount({
      onRowClick: (row: Row) => rowClicks.push(row.id),
    });
    const cell = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(cell, { button: 0, clientX: 0, clientY: 0 });
    await fireEvent.pointerUp(document);
    await fireEvent.click(cell);
    expect(cell.classList.contains('dt-sel-focus')).toBe(true);
    expect(rowClicks).toEqual(['r1']);
    unmount();
  });

  it('a drag beyond the threshold suppresses the trailing row click', async () => {
    const rowClicks: string[] = [];
    const { container, unmount } = await mount({
      onRowClick: (row: Row) => rowClicks.push(row.id),
    });
    const start = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(start, { button: 0, clientX: 0, clientY: 0 });
    const end = cellOf(container, 1, 'qty');
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(end);
    await fireEvent.pointerMove(document, { clientX: 0, clientY: 80 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();
    await fireEvent.click(start);
    expect(rowClicks).toEqual([]);
    unmount();
  });
});

describe('DataTable — copy (Ctrl/Cmd+C)', () => {
  it('range copy produces the expected TSV — visible columns only, hidden column excluded', async () => {
    const { container, unmount } = await mount();
    const a = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    const b = cellOf(container, 2, 'active');
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(b);
    await fireEvent.pointerMove(document, { clientX: 0, clientY: 80 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();

    const { event, data } = copyEvent();
    await fireEvent(scrollEl(container), event);
    const tsv = data.getData('text/plain');
    expect(tsv).toBe('Alpha\t10\tTRUE\nBeta\t20\tFALSE\nGamma\t30\tTRUE');
    expect(tsv).not.toContain('hidden-');
    expect(data.getData('text/html')).toContain('<table>');
    unmount();
  });

  it('copied outline classes land on the boundary cells and survive an arrow move', async () => {
    const { container, unmount } = await mount();
    const a = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    const b = cellOf(container, 2, 'qty');
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(b);
    await fireEvent.pointerMove(document, { clientX: 0, clientY: 80 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();

    const { event } = copyEvent();
    await fireEvent(scrollEl(container), event);

    expect(cellOf(container, 0, 'name').classList.contains('dt-copy-t')).toBe(true);
    expect(cellOf(container, 0, 'name').classList.contains('dt-copy-l')).toBe(true);
    expect(cellOf(container, 2, 'qty').classList.contains('dt-copy-b')).toBe(true);
    expect(cellOf(container, 2, 'qty').classList.contains('dt-copy-r')).toBe(true);

    // Pure selection move (arrow key) must NOT clear the copied outline.
    await fireEvent.keyDown(scrollEl(container), { key: 'ArrowRight' });
    expect(cellOf(container, 2, 'active').classList.contains('dt-sel-focus')).toBe(true);
    expect(cellOf(container, 0, 'name').classList.contains('dt-copy-t')).toBe(true);
    expect(cellOf(container, 2, 'qty').classList.contains('dt-copy-b')).toBe(true);

    // Escape clears it.
    await fireEvent.keyDown(scrollEl(container), { key: 'Escape' });
    expect(cellOf(container, 0, 'name').classList.contains('dt-copy-t')).toBe(false);
    unmount();
  });

  it('row-selection copy includes all visible columns for the selected rows, and wins over a cell range', async () => {
    const { container, unmount } = await mount();
    // Establish a cell range first — row selection must still win.
    const a = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    await fireEvent.pointerUp(document);

    await fireEvent.click(checkboxOf(container, 0));
    await fireEvent.click(checkboxOf(container, 2));

    const { event, data } = copyEvent();
    await fireEvent(scrollEl(container), event);
    const tsv = data.getData('text/plain');
    expect(tsv).toBe('Alpha\t10\tTRUE\tA1\nGamma\t30\tTRUE\tC3');
    unmount();
  });
});

describe('DataTable — paste (Ctrl/Cmd+V)', () => {
  it('pastes a 2×2 TSV into editable cells and skips the read-only column', async () => {
    const onSaveRow = vi.fn(async (_row: Row, _draft: Record<string, string>) => true);
    const { container, unmount } = await mount({ onSaveRow });
    const a = cellOf(container, 0, 'name');
    await fireEvent.pointerDown(a, { button: 0, clientX: 0, clientY: 0 });
    const b = cellOf(container, 1, 'qty');
    const efp = vi.spyOn(document, 'elementFromPoint').mockReturnValue(b);
    await fireEvent.pointerMove(document, { clientX: 0, clientY: 40 });
    await fireEvent.pointerUp(document);
    efp.mockRestore();

    await fireEvent(scrollEl(container), pasteEvent('X\t99\nY\t88'));

    await waitFor(() => expect(onSaveRow).toHaveBeenCalledTimes(2));
    const [row0, draft0] = onSaveRow.mock.calls[0];
    const [row1, draft1] = onSaveRow.mock.calls[1];
    expect(row0.id).toBe('r1');
    expect(draft0.name).toBe('X');
    expect(draft0.qty).toBe('99');
    expect(row1.id).toBe('r2');
    expect(draft1.name).toBe('Y');
    expect(draft1.qty).toBe('88');
    // 'code' is not editable — never part of the editable-column snapshot.
    expect(draft0.code).toBeUndefined();
    unmount();
  });
});
