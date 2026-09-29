// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdvancedFilterBuilder from './AdvancedFilterBuilder.svelte';
import { isFilterGroup, type FilterColumnMeta, type FilterGroup } from './filters';

afterEach(() => cleanup());

const columns: FilterColumnMeta[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  { key: 'age', label: 'Age', kind: 'number' },
];

function baseGroup(): FilterGroup {
  return {
    id: 'g1',
    logic: 'and',
    items: [
      { id: 'r1', key: 'name', value: { kind: 'text', op: 'contains', text: 'a' } },
      { id: 'r2', key: 'age', value: { kind: 'number', op: 'gt', min: 1, max: null } },
    ],
  };
}

/** Top-level rows only (excludes rows rendered by a nested `<svelte:self>`). */
function topRows(container: HTMLElement): HTMLElement[] {
  const root = container.querySelector(':scope > .afb') as HTMLElement;
  return Array.from(root.querySelectorAll(':scope > .afb-row'));
}
/** A top-level row's own "…" kebab trigger — the only bare <button> directly
 *  on the row (Selects render <select>, not <button>). */
function kebabOf(row: HTMLElement): HTMLElement {
  return row.querySelector(':scope > button') as HTMLElement;
}
/** Every Dropdown's menu content stays mounted (Zag toggles `data-state`), so
 *  a global text query matches every menu's copy of a shared label — scope to
 *  the one currently open. */
async function clickMenuItem(label: string) {
  const menu = await waitFor(() => {
    const el = document.querySelector('[data-part="content"][data-state="open"]');
    if (!el) throw new Error('no open menu');
    return el as HTMLElement;
  });
  const item = within(menu).getByText(label).closest('[data-part="item"]') as HTMLElement;
  // Zag's menu selects on the pointerdown/pointerup pair, not a bare click.
  await fireEvent.pointerDown(item);
  await fireEvent.pointerUp(item);
  await fireEvent.click(item);
}

describe('AdvancedFilterBuilder', () => {
  it('renders one row per rule, "Where" on the first and an And/Or select on the second', () => {
    const { container } = render(AdvancedFilterBuilder, {
      props: { group: baseGroup(), columns, onChange: vi.fn(), onDelete: vi.fn() },
    });
    const rows = topRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Where');
    const propertySelects = rows.map(
      (r) => r.querySelector('select[aria-label="Property"]') as HTMLSelectElement,
    );
    expect(propertySelects.map((s) => s.value)).toEqual(['name', 'age']);
    const logicSelect = rows[1].querySelector('.afb-logic select') as HTMLSelectElement;
    expect(logicSelect.value).toBe('and');
  });

  it('duplicates a rule via its "…" menu, inserting the clone right after with a fresh id', async () => {
    const onChange = vi.fn();
    const { container } = render(AdvancedFilterBuilder, {
      props: { group: baseGroup(), columns, onChange, onDelete: vi.fn() },
    });
    const rows = topRows(container);
    await fireEvent.click(kebabOf(rows[1]));
    await clickMenuItem('Duplicate');

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as FilterGroup;
    expect(next.items).toHaveLength(3);
    expect(next.items[1]).toMatchObject({
      key: 'age',
      value: { kind: 'number', op: 'gt', min: 1 },
    });
    expect(next.items[2]).toMatchObject({
      key: 'age',
      value: { kind: 'number', op: 'gt', min: 1 },
    });
    expect(next.items[2].id).not.toBe(next.items[1].id);
  });

  it('wraps a rule in a group, then turns it back into a plain rule', async () => {
    const onChange = vi.fn();
    let group = baseGroup();
    const { container, rerender } = render(AdvancedFilterBuilder, {
      props: { group, columns, onChange, onDelete: vi.fn() },
    });

    // Wrap the first rule (name) in a group via its "…" menu.
    await fireEvent.click(kebabOf(topRows(container)[0]));
    await clickMenuItem('Turn into group');
    expect(onChange).toHaveBeenCalledTimes(1);
    group = onChange.mock.calls[0][0] as FilterGroup;
    expect(isFilterGroup(group.items[0])).toBe(true);
    if (isFilterGroup(group.items[0])) {
      expect(group.items[0].items).toEqual([
        { id: 'r1', key: 'name', value: { kind: 'text', op: 'contains', text: 'a' } },
      ]);
    }
    await rerender({ group, columns, onChange, onDelete: vi.fn() });

    // Turn it back: the OUTER row for index 0 is now a group row, whose own
    // kebab offers "Turn into filter" (unwrap to its first rule).
    onChange.mockClear();
    await fireEvent.click(kebabOf(topRows(container)[0]));
    await clickMenuItem('Turn into filter');
    expect(onChange).toHaveBeenCalledTimes(1);
    const restored = onChange.mock.calls[0][0] as FilterGroup;
    expect(restored.items[0]).toMatchObject({
      key: 'name',
      value: { kind: 'text', op: 'contains', text: 'a' },
    });
    expect(isFilterGroup(restored.items[0])).toBe(false);
  });

  it('switches the group logic between and/or via the second row select', async () => {
    const onChange = vi.fn();
    const { container } = render(AdvancedFilterBuilder, {
      props: { group: baseGroup(), columns, onChange, onDelete: vi.fn() },
    });
    const logicSelect = topRows(container)[1].querySelector(
      '.afb-logic select',
    ) as HTMLSelectElement;
    await fireEvent.change(logicSelect, { target: { value: 'or' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ logic: 'or' }));
  });
});
