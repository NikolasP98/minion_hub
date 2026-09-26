/**
 * Which tags the calendar's toolbar filter offers: only the ones carried by
 * bookings inside the VISIBLE date range (owner ask 2026-09-26: "filter-able
 * tags should only show tags based on items visible on the selected date
 * range"), plus whatever is already selected, so a selection can always be
 * cleared even after scrolling away from the events that justified it.
 *
 * `dayOf` is injected: which local day an instant belongs to is the calendar's
 * timezone policy (browser wall clock today), and this helper must not pick a
 * second one. `range` is inclusive on both ends, `YYYY-MM-DD`.
 */
export function visibleTagOptions<T extends { id: string }>(args: {
  options: readonly T[];
  bookings: readonly { start: string; tags?: readonly { id: string }[] | null }[];
  range: { first: string; last: string } | null;
  selected: ReadonlySet<string>;
  dayOf: (iso: string) => string;
}): T[] {
  const { options, bookings, range, selected, dayOf } = args;
  if (!range) return [...options];
  const keep = new Set(selected);
  for (const b of bookings) {
    const day = dayOf(b.start);
    if (day < range.first || day > range.last) continue;
    for (const t of b.tags ?? []) keep.add(t.id);
  }
  return options.filter((t) => keep.has(t.id));
}
