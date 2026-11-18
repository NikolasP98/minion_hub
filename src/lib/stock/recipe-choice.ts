/**
 * Substitute items in a recipe (meta spec 131). A recipe row (`stk_consumption`)
 * with no `choicePath` is always consumed. A path like `1.0/2.1` reads "option 0
 * of choice 1, and inside it option 1 of choice 2": rows in the same choice but
 * different options are alternatives (one OR the other), rows with the same path
 * are consumed together. So `A + (B | C)`, `A | (B + C)` and `X + (Y | (W + Z))`
 * are all plain rows with paths, and the recipe stays one row per item.
 *
 * A choice's lowest option is its DEFAULT: what a booking reserves and what a
 * sale issues when nobody is there to pick. Staff pick at completion.
 */

export type ChoiceRow = { itemId: string; choicePath: string | null; finProductId?: string };
export type Seg = { group: number; option: number };
/** Chosen option per choice group; a group not in the map takes its default. */
export type Picks = ReadonlyMap<number, number>;

const PATH = /^\d{1,4}\.\d{1,4}(\/\d{1,4}\.\d{1,4})*$/;

export function segments(path: string | null | undefined): Seg[] {
  if (!path) return [];
  return path.split('/').map((s) => {
    const [group, option] = s.split('.').map(Number);
    return { group, option };
  });
}

export function joinPath(segs: Seg[]): string | null {
  return segs.length ? segs.map((s) => `${s.group}.${s.option}`).join('/') : null;
}

/** Rows chosen by `picks` (every choice not picked takes its default). Rows of
 *  several recipes may be mixed: choice groups are scoped by `finProductId`. */
export function selectedRows<T extends ChoiceRow>(rows: T[], picks: Picks = new Map()): T[] {
  const key = (r: ChoiceRow, g: number) => `${r.finProductId ?? ''}|${g}`;
  const min = new Map<string, number>();
  for (const r of rows)
    for (const s of segments(r.choicePath))
      min.set(key(r, s.group), Math.min(min.get(key(r, s.group)) ?? Infinity, s.option));
  return rows.filter((r) =>
    segments(r.choicePath).every(
      (s) => s.option === (picks.get(s.group) ?? min.get(key(r, s.group))),
    ),
  );
}

/** What the recipe consumes when nobody picks: every choice at its default. */
export function defaultBranch<T extends ChoiceRow>(rows: T[]): T[] {
  return selectedRows(rows);
}

/** Null when the set of paths of ONE recipe is coherent, else the reason. A
 *  choice must sit at one place in the tree, and appear once per path. */
export function choicePathError(rows: ChoiceRow[]): string | null {
  const prefixOf = new Map<number, string | null>();
  for (const r of rows) {
    if (r.choicePath == null) continue;
    if (!PATH.test(r.choicePath)) return `invalid choice path "${r.choicePath}"`;
    const segs = segments(r.choicePath);
    const seen = new Set<number>();
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i].group;
      if (seen.has(g)) return `choice ${g} repeats in "${r.choicePath}"`;
      seen.add(g);
      const prefix = joinPath(segs.slice(0, i));
      if (prefixOf.has(g) && prefixOf.get(g) !== prefix) return `choice ${g} sits in two places`;
      prefixOf.set(g, prefix);
    }
  }
  return null;
}

export type RecipeOption<T> = { option: number; path: string; nodes: RecipeNode<T>[] };
export type RecipeNode<T> =
  { kind: 'item'; row: T } | { kind: 'choice'; group: number; options: RecipeOption<T>[] };

/** The rows as a tree, in input order, options default-first. A choice left
 *  with one option (its alternatives deleted) is shown as plain rows. */
export function recipeTree<T extends ChoiceRow>(rows: T[], depth = 0): RecipeNode<T>[] {
  const out: (RecipeNode<T> | { group: number })[] = [];
  const byGroup = new Map<number, Map<number, T[]>>();
  for (const r of rows) {
    const seg = segments(r.choicePath)[depth];
    if (!seg) {
      out.push({ kind: 'item', row: r });
      continue;
    }
    let opts = byGroup.get(seg.group);
    if (!opts) {
      byGroup.set(seg.group, (opts = new Map()));
      out.push({ group: seg.group });
    }
    opts.set(seg.option, [...(opts.get(seg.option) ?? []), r]);
  }
  return out.flatMap((n): RecipeNode<T>[] => {
    if ('kind' in n) return [n];
    const options = [...byGroup.get(n.group)!]
      .sort(([a], [b]) => a - b)
      .map(([option, optRows]) => ({
        option,
        path: joinPath(segments(optRows[0].choicePath).slice(0, depth + 1))!,
        nodes: recipeTree(optRows, depth + 1),
      }));
    return options.length === 1 ? options[0].nodes : [{ kind: 'choice', group: n.group, options }];
  });
}

/** "Or…" on a row: `add` becomes an alternative to `targetItemId` ALONE. A row
 *  that is the only thing in its option gets a sibling option; a row consumed
 *  with others is wrapped in a new choice, so its companions stay put. */
export function addAlternative<T extends ChoiceRow>(rows: T[], targetItemId: string, add: T): T[] {
  const target = rows.find((r) => r.itemId === targetItemId);
  if (!target) return rows;
  const segs = segments(target.choicePath);
  const p = target.choicePath;
  const alone =
    p != null &&
    !rows.some((r) => r !== target && (r.choicePath === p || r.choicePath?.startsWith(`${p}/`)));
  if (alone) {
    const last = segs[segs.length - 1];
    const used = rows.flatMap((r) => segments(r.choicePath).filter((s) => s.group === last.group));
    const option = 1 + Math.max(...used.map((s) => s.option));
    return [
      ...rows,
      { ...add, choicePath: joinPath([...segs.slice(0, -1), { group: last.group, option }]) },
    ];
  }
  const group = 1 + Math.max(0, ...rows.flatMap((r) => segments(r.choicePath).map((s) => s.group)));
  return [
    ...rows.map((r) =>
      r === target ? { ...r, choicePath: joinPath([...segs, { group, option: 0 }]) } : r,
    ),
    { ...add, choicePath: joinPath([...segs, { group, option: 1 }]) },
  ];
}

/** Make `option` the default of `group` by swapping it with the current default. */
export function makeDefault<T extends ChoiceRow>(rows: T[], group: number, option: number): T[] {
  const current = Math.min(
    ...rows.flatMap((r) =>
      segments(r.choicePath)
        .filter((s) => s.group === group)
        .map((s) => s.option),
    ),
  );
  if (!Number.isFinite(current) || current === option) return rows;
  const swap = (o: number) => (o === option ? current : o === current ? option : o);
  return rows.map((r) => {
    const segs = segments(r.choicePath);
    if (!segs.some((s) => s.group === group)) return r;
    return {
      ...r,
      choicePath: joinPath(
        segs.map((s) => (s.group === group ? { group, option: swap(s.option) } : s)),
      ),
    };
  });
}
