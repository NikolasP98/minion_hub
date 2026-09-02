import type { Snippet } from 'svelte';

export type PickerSelectionMode = 'single' | 'multiple';
export type PickerDuplicatePolicy = 'allow' | 'prevent';

/** One context-aware column in the picker browse table. */
export interface PickerColumn<T> {
  key: string;
  label: string;
  /** Cell text; defaults to `String(row[key] ?? '')`. */
  value?: (row: T) => string;
  align?: 'left' | 'right';
  /** Lower values render first. Array order breaks ties. */
  priority?: number;
  /** Stronger cell treatment for the column that identifies the primitive. */
  emphasis?: 'primary' | 'secondary';
  /** Omit this column from the context's initial view. */
  defaultHidden?: boolean;
  /** Whether a user may toggle the column when column controls are enabled. */
  hideable?: boolean;
  /** Include the column in the default client-side search corpus. */
  searchable?: boolean;
}

export interface PickerCreateContext<T> {
  oncreated: (row: T) => void;
  oncancel: () => void;
}

export interface PickerCreateConfig<T> {
  /** Label on the browse toolbar's create action. */
  label: string;
  /** Label on the closable create tab. Defaults to `label`. */
  tabLabel?: string;
  /** Optional context shown above the form. */
  description?: string;
  form: Snippet<[PickerCreateContext<T>]>;
}

export type PickerLoadResult<T> = T[] | { rows: T[]; total?: number };

export function orderPickerColumns<T>(columns: PickerColumn<T>[]): PickerColumn<T>[] {
  return columns
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (a.column.priority ?? Number.MAX_SAFE_INTEGER) -
          (b.column.priority ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map(({ column }) => column);
}

export function defaultPickerHidden<T>(columns: PickerColumn<T>[]): Set<string> {
  return new Set(
    columns.filter((column) => column.defaultHidden && column.hideable !== false).map((c) => c.key),
  );
}

export function reconcilePickerHidden<T>(
  columns: PickerColumn<T>[],
  requested: Iterable<string>,
): Set<string> {
  const known = new Set(columns.map((column) => column.key));
  const locked = new Set(
    columns.filter((column) => column.hideable === false).map((column) => column.key),
  );
  const hidden = new Set([...requested].filter((key) => known.has(key) && !locked.has(key)));
  if (columns.length > 0 && hidden.size === columns.length) hidden.delete(columns[0].key);
  return hidden;
}

export function pickerRowIsDuplicate(
  id: string,
  selectionMode: PickerSelectionMode,
  duplicatePolicy: PickerDuplicatePolicy,
  pickedIds: ReadonlySet<string> | undefined,
  sessionPickedIds: ReadonlySet<string>,
): boolean {
  return (
    selectionMode === 'multiple' &&
    duplicatePolicy === 'prevent' &&
    (pickedIds?.has(id) === true || sessionPickedIds.has(id))
  );
}

/**
 * Controlled picker state always wins over the local session cache. This lets
 * an invoking form remove a row while the picker is open without leaving the
 * row visually selected or duplicate-blocked inside the picker.
 */
export function effectivePickerPickedIds(
  pickedIds: ReadonlySet<string> | undefined,
  sessionPickedIds: ReadonlySet<string>,
): ReadonlySet<string> {
  return pickedIds ?? sessionPickedIds;
}

/** What clicking a browse row does, given the picker's current contract. */
export type PickerRowAction = 'add' | 'remove' | 'blocked';

/**
 * Resolves a row to its single actionable verb, so the row, its button, its
 * icon, and its label can never disagree about what a click will do.
 *
 * `remove` requires the consumer to have supplied an unpick handler: without a
 * way to tell the invoking form to drop the row, a picked row stays `blocked`
 * (the pre-toggle behavior) rather than offering an action that goes nowhere.
 */
export function pickerRowAction(input: {
  picked: boolean;
  canUnpick: boolean;
  duplicate: boolean;
}): PickerRowAction {
  if (input.picked && input.canUnpick) return 'remove';
  if (input.duplicate) return 'blocked';
  return 'add';
}
