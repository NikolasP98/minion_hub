import { describe, expect, it } from 'vitest';
import {
  defaultPickerHidden,
  effectivePickerPickedIds,
  orderPickerColumns,
  pickerRowAction,
  pickerRowIsDuplicate,
  reconcilePickerHidden,
  type PickerColumn,
} from './picker';

type Row = { id: string; name: string };

const columns: PickerColumn<Row>[] = [
  { key: 'metadata', label: 'Metadata', priority: 30, defaultHidden: true },
  { key: 'name', label: 'Name', priority: 10, hideable: false },
  { key: 'code', label: 'Code', priority: 20 },
];

describe('picker configuration', () => {
  it('orders context columns by priority without mutating the caller array', () => {
    expect(orderPickerColumns(columns).map((column) => column.key)).toEqual([
      'name',
      'code',
      'metadata',
    ]);
    expect(columns[0].key).toBe('metadata');
  });

  it('keeps required columns visible and drops stale persisted keys', () => {
    expect(defaultPickerHidden(columns)).toEqual(new Set(['metadata']));
    expect(reconcilePickerHidden(columns, ['name', 'metadata', 'removed'])).toEqual(
      new Set(['metadata']),
    );
  });

  it('distinguishes duplicate-allowing lists from set-like multi-pickers', () => {
    const existing = new Set(['item-1']);
    const session = new Set(['item-2']);
    expect(pickerRowIsDuplicate('item-1', 'multiple', 'prevent', existing, session)).toBe(true);
    expect(pickerRowIsDuplicate('item-2', 'multiple', 'prevent', existing, session)).toBe(true);
    expect(pickerRowIsDuplicate('item-1', 'multiple', 'allow', existing, session)).toBe(false);
    expect(pickerRowIsDuplicate('item-1', 'single', 'prevent', existing, session)).toBe(false);
  });

  it('treats controlled selections as authoritative after the invoking form removes a row', () => {
    const staleSession = new Set(['item-1', 'item-2']);
    const controlled = new Set(['item-2']);

    expect(effectivePickerPickedIds(controlled, staleSession)).toBe(controlled);
    expect(effectivePickerPickedIds(controlled, staleSession).has('item-1')).toBe(false);
    expect(effectivePickerPickedIds(undefined, staleSession)).toBe(staleSession);
  });
});

describe('picker row actions', () => {
  const picked = { picked: true, canUnpick: true, duplicate: true };

  it('offers removal for a picked row once the consumer can unpick', () => {
    expect(pickerRowAction(picked)).toBe('remove');
  });

  it('keeps a picked row blocked when the consumer supplied no unpick handler', () => {
    expect(pickerRowAction({ ...picked, canUnpick: false })).toBe('blocked');
  });

  it('adds an unpicked row whether or not unpicking is available', () => {
    expect(pickerRowAction({ picked: false, canUnpick: true, duplicate: false })).toBe('add');
    expect(pickerRowAction({ picked: false, canUnpick: false, duplicate: false })).toBe('add');
  });

  it('lets a duplicate-allowing picker re-add a row it already holds', () => {
    expect(pickerRowAction({ picked: true, canUnpick: false, duplicate: false })).toBe('add');
  });
});
