/**
 * Typo-tolerant entity lookup for assistant fills ("hyaluronidasa" →
 * "Hialuronidasa"). Bigram Dice similarity over accent-stripped lowercase text,
 * with exact / prefix / substring matches ranked first.
 *
 * ponytail: no dependency, ~O(n·len) per query; fine for the few-hundred-row
 * lists the pickers already hold in memory.
 */

export interface FuzzyHit<T> {
  item: T;
  score: number;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 0..1 similarity; 1 = identical after normalisation. */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (nb.startsWith(na) || na.startsWith(nb)) return 0.95;
  if (nb.includes(na) || na.includes(nb)) return 0.9;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const [g, c] of ga) {
    total += c;
    inter += Math.min(c, gb.get(g) ?? 0);
  }
  for (const c of gb.values()) total += c;
  return total ? (2 * inter) / total : 0;
}

/** Rank `items` by the best similarity across the strings `keys` yields for each. */
export function rank<T>(
  query: string,
  items: T[],
  keys: (item: T) => Array<string | null | undefined>,
): FuzzyHit<T>[] {
  return items
    .map((item) => ({
      item,
      score: Math.max(0, ...keys(item).map((k) => (k ? similarity(query, k) : 0))),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Pick the best match when it is confident (score ≥ `accept`) and clearly ahead of
 * the runner-up; otherwise return the top candidates for a "did you mean" reply.
 */
export function fuzzyFind<T>(
  query: string,
  items: T[],
  keys: (item: T) => Array<string | null | undefined>,
  opts: { accept?: number; candidates?: number } = {},
): { match: T | null; candidates: T[] } {
  const accept = opts.accept ?? 0.72;
  const hits = rank(query, items, keys);
  const [best, second] = hits;
  const confident =
    !!best &&
    best.score >= accept &&
    (!second || best.score - second.score >= 0.08 || best.score >= 0.95);
  return {
    match: confident ? best.item : null,
    candidates: hits.slice(0, opts.candidates ?? 3).map((h) => h.item),
  };
}
