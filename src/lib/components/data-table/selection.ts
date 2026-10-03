export type RowSelectionMode = 'projection' | 'all-matching';

export interface RowSelectionCounts {
  total: number;
  visible: number;
  hidden: number;
}

/** Ordinary selection can never retain an id absent from the current data projection. */
export function reconcileProjectionSelection(
  selected: ReadonlySet<string>,
  currentIds: Iterable<string>,
): Set<string> {
  const current = new Set(currentIds);
  return new Set([...selected].filter((id) => current.has(id)));
}

export function rowSelectionCounts(
  selected: ReadonlySet<string>,
  currentIds: Iterable<string>,
): RowSelectionCounts {
  const current = new Set(currentIds);
  let visible = 0;
  for (const id of selected) if (current.has(id)) visible++;
  return { total: selected.size, visible, hidden: selected.size - visible };
}

export function sameSelection(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}
