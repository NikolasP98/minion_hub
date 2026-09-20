/**
 * Pure tag-inheritance helpers (no DB): recipes inherit their ingredients'
 * tags through the item composition DAG, and any entity may present several
 * tag sources merged without duplicates.
 */
export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface ParentChildEdge {
  parentItemId: string;
  childItemId: string;
}

/**
 * Every descendant (children, grandchildren, …) of each root through `edges`,
 * excluding the root itself. Cycles are tolerated (the DAG is cycle-checked on
 * write, but a read must never hang on bad data).
 */
export function descendantIds(
  edges: readonly ParentChildEdge[],
  roots: readonly string[],
): Map<string, Set<string>> {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.parentItemId);
    if (list) list.push(e.childItemId);
    else children.set(e.parentItemId, [e.childItemId]);
  }
  const out = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>();
    const stack = [...(children.get(root) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === root || seen.has(id)) continue;
      seen.add(id);
      for (const c of children.get(id) ?? []) if (!seen.has(c)) stack.push(c);
    }
    out.set(root, seen);
  }
  return out;
}

/** Concatenate tag lists keeping first occurrence of each id (source order wins). */
export function mergeTags<T extends TagRef>(...lists: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/** Tags inherited by each root from its descendants' own tags, merged. */
export function inheritedFromDescendants<T extends TagRef>(
  edges: readonly ParentChildEdge[],
  roots: readonly string[],
  ownTags: ReadonlyMap<string, readonly T[]>,
  extra: ReadonlyMap<string, readonly string[]> = new Map(),
): Map<string, T[]> {
  const desc = descendantIds(edges, roots);
  const out = new Map<string, T[]>();
  for (const root of roots) {
    const ids = new Set(desc.get(root) ?? []);
    for (const id of extra.get(root) ?? []) ids.add(id);
    out.set(root, mergeTags(...[...ids].map((id) => ownTags.get(id) ?? [])));
  }
  return out;
}
