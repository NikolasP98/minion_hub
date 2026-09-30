// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { StockItemOption } from './StockItemCreateForm.svelte';

// Same requirement as Picker.dom.test.ts: DataTable only mounts its row
// virtualizer `if (browser && wrapperEl)`.
vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: StockItemPicker } = await import('./StockItemPicker.svelte');

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'TR' ? 44 : 480;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => cleanup());

// No `itemGroup` on either row — the field left StockItemOption's core shape
// (proposal 2026-09-30-hub-stock-item-optional-fields-to-custom-columns.md).
const items: StockItemOption[] = [
  { id: '1', code: 'WID-1', name: 'Widget', uom: 'unit' },
  { id: '2', code: 'GAD-2', name: 'Gadget', uom: 'unit' },
];

async function rowNames(): Promise<string[]> {
  let names: string[] = [];
  await waitFor(() => {
    names = [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-index]')].map(
      (tr) => tr.textContent ?? '',
    );
    expect(names.length).toBeGreaterThan(0);
  });
  return names;
}

describe('StockItemPicker search (no itemGroup field)', () => {
  it('shows every item with no search term', async () => {
    render(StockItemPicker, { props: { open: true, items, onPick: () => {} } });
    const names = await rowNames();
    expect(names.some((n) => n.includes('Widget'))).toBe(true);
    expect(names.some((n) => n.includes('Gadget'))).toBe(true);
  });

  it('filters to matches on name/code alone', async () => {
    render(StockItemPicker, { props: { open: true, items, onPick: () => {} } });
    await rowNames();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(input).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'Widget' } });
    await waitFor(() => {
      const names = [...document.querySelectorAll<HTMLElement>('tbody tr[data-row-index]')].map(
        (tr) => tr.textContent ?? '',
      );
      expect(names.some((n) => n.includes('Widget'))).toBe(true);
      expect(names.some((n) => n.includes('Gadget'))).toBe(false);
    });
  });
});
