// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/svelte';

// Owner directive 2026-09-29: "every cell is selectable, but not all are
// editable." A table that opts into cell editing at all (some column is
// `editable`/`customEditable`) makes EVERY cell selectable — a read-only
// cell shows the same selection ring and is reachable by arrow keys, but
// clicking it twice / pressing Enter on it never opens anything. A custom
// column (e.g. the tags cell) opens via the `open`/`onOpenChange`
// DataCellContext fields instead of owning its own always-visible trigger.
vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: Harness } = await import('./DataTable.cell-select.fixture.svelte');

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

async function mount() {
  const view = render(Harness);
  await waitFor(() => {
    expect(view.container.querySelectorAll('tbody tr[data-row-index]').length).toBe(2);
  });
  return view;
}

const cellOf = (container: HTMLElement, rowIndex: number, key: string) =>
  container.querySelector<HTMLTableCellElement>(
    `tbody tr[data-row-index="${rowIndex}"] td[data-col="${key}"]`,
  )!;

describe('DataTable — every cell selectable, only editable cells editable', () => {
  it('a read-only cell selects on click but never opens an editor', async () => {
    const { container, unmount } = await mount();
    const cell = cellOf(container, 0, 'ro');
    expect(cell.getAttribute('data-editable')).toBe('false');
    expect(cell.classList.contains('dt-editable')).toBe(false);

    await fireEvent.pointerDown(cell, { button: 0 });
    expect(cell.classList.contains('dt-sel-focus')).toBe(true);

    // Second click (the "open it" gesture on an editable cell) stays inert here.
    await fireEvent.pointerDown(cell, { button: 0 });
    expect(cell.querySelector('input')).toBeNull();

    await fireEvent.keyDown(container.querySelector('.dt-scroll')!, { key: 'Enter' });
    expect(cell.querySelector('input')).toBeNull();
    unmount();
  });

  it('arrow-right moves selection onto a read-only column instead of skipping it', async () => {
    const { container, unmount } = await mount();
    const tagCell = cellOf(container, 0, 'tag');
    const roCell = cellOf(container, 0, 'ro');
    await fireEvent.pointerDown(tagCell, { button: 0 });
    expect(tagCell.classList.contains('dt-sel-focus')).toBe(true);

    await fireEvent.keyDown(container.querySelector('.dt-scroll')!, { key: 'ArrowRight' });
    expect(roCell.classList.contains('dt-sel-focus')).toBe(true);
    expect(tagCell.classList.contains('dt-sel-focus')).toBe(false);
    unmount();
  });

  it('a custom (tag) cell opens via the second click and via Enter, and the caller can close it', async () => {
    const { container, getByTestId, unmount } = await mount();
    const cell = cellOf(container, 0, 'tag');
    expect(getByTestId('tag-open-row-1').textContent).toBe('false');

    await fireEvent.pointerDown(cell, { button: 0 }); // select
    expect(getByTestId('tag-open-row-1').textContent).toBe('false');
    await fireEvent.pointerDown(cell, { button: 0 }); // second click on the selected cell opens it
    expect(getByTestId('tag-open-row-1').textContent).toBe('true');

    await fireEvent.click(getByTestId('tag-close-row-1')); // caller-initiated close (Escape/outside/pick)
    expect(getByTestId('tag-open-row-1').textContent).toBe('false');

    await fireEvent.keyDown(container.querySelector('.dt-scroll')!, { key: 'Enter' });
    expect(getByTestId('tag-open-row-1').textContent).toBe('true');
    unmount();
  });

  it('selecting a different cell closes a custom cell left open', async () => {
    const { container, getByTestId, unmount } = await mount();
    const tagCell = cellOf(container, 0, 'tag');
    const roCell = cellOf(container, 0, 'ro');
    await fireEvent.pointerDown(tagCell, { button: 0 });
    await fireEvent.pointerDown(tagCell, { button: 0 });
    expect(getByTestId('tag-open-row-1').textContent).toBe('true');

    await fireEvent.pointerDown(roCell, { button: 0 });
    expect(getByTestId('tag-open-row-1').textContent).toBe('false');
    unmount();
  });
});
