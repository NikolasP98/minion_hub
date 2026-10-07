/**
 * Append-only subcolumn lane list for one mounted calendar session (HC-018).
 *
 * The runway's week cache loads and evicts weeks as the operator scrolls, so
 * the set of distinct facet values in the loaded window changes constantly. If
 * the lanes were re-derived (and re-sorted) from that set, a newly loaded week
 * could insert a lane in the middle and every visible day would redivide.
 *
 * `mergeLanes` keeps the spatial map stable: lanes already shown keep their
 * relative order, a value seen for the first time is appended (before the
 * trailing unclassified lane), and nothing is removed because its value
 * scrolled out. The caller hands `seen` over in registry order, so the FIRST
 * merge (empty session) still produces the registry order — only later merges
 * append. Changing the axis is the caller's reset (pass `existing = []`).
 *
 * Returns `existing` itself when nothing changed, so an effect persisting the
 * list into `$state` can compare by identity and never loop.
 */
export function mergeLanes(
  existing: readonly (string | null)[],
  seen: readonly (string | null)[],
): readonly (string | null)[] {
  const known = new Set(existing);
  const fresh = seen.filter((id) => id !== null && !known.has(id));
  const unset = known.has(null) || seen.includes(null);
  if (fresh.length === 0 && (!unset || known.has(null))) return existing;
  return [...existing.filter((id) => id !== null), ...fresh, ...(unset ? [null] : [])];
}
