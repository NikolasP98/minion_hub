/**
 * One changelog entry — and one `app.update` notification — per DAY, not per
 * push (owner 2026-10-14: five "What's new in hub-v2026.10.15-n" in a row).
 *
 * The release-notes Action tags every push to master `hub-vYYYY.MM.DD` and
 * suffixes `-n` for the day's later pushes, so the tag already carries the
 * day: the day key is the tag without that suffix. Rows stay per tag in
 * `app_releases` (the Action upserts by version); the grouping is a read-side
 * fold, so history before this change joins up too.
 */
/** `sections`/`prs` are `unknown` here because that is how the jsonb columns
 *  type out of Drizzle; the fold reads them in their stored shapes. */
export interface ReleaseLike {
  id: string;
  version: string;
  releasedAt: string | Date;
  sections: unknown;
  prs: unknown;
}

type Sections = Record<string, Record<string, string[]>>;
type Pr = { number: number; title: string; url: string };
const prsOf = (row: ReleaseLike): Pr[] => (Array.isArray(row.prs) ? (row.prs as Pr[]) : []);

/** `hub-v2026.10.15-4` → `hub-v2026.10.15`; a bare tag is its own key. */
export function releaseDayKey(version: string): string {
  return version.replace(/-\d+$/, '');
}

/**
 * Fold same-day rows into one, keeping the input order (newest first) for the
 * day keys. Sections append per label/scope; PRs dedupe by number; the day's
 * `releasedAt` is its latest push; `id` is the first row's.
 */
export function groupReleasesByDay<T extends ReleaseLike>(rows: T[]): T[] {
  const byDay = new Map<string, T>();
  for (const row of rows) {
    const key = releaseDayKey(row.version);
    const acc = byDay.get(key);
    if (!acc) {
      byDay.set(key, {
        ...row,
        version: key,
        sections: cloneSections(row.sections as Sections),
        prs: [...prsOf(row)],
      });
      continue;
    }
    const sections = acc.sections as Sections;
    for (const [label, byScope] of Object.entries((row.sections ?? {}) as Sections)) {
      const target = (sections[label] ??= {});
      for (const [scope, lines] of Object.entries(byScope)) {
        const prev = (target[scope] ??= []);
        for (const line of lines) if (!prev.includes(line)) prev.push(line);
      }
    }
    const accPrs = prsOf(acc);
    const seen = new Set(accPrs.map((p) => p.number));
    for (const pr of prsOf(row)) if (!seen.has(pr.number)) accPrs.push(pr);
    acc.prs = accPrs;
    if (new Date(row.releasedAt) > new Date(acc.releasedAt)) acc.releasedAt = row.releasedAt;
  }
  return [...byDay.values()];
}

function cloneSections(sections: Sections): Sections {
  const out: Sections = {};
  for (const [label, byScope] of Object.entries(sections ?? {})) {
    out[label] = {};
    for (const [scope, lines] of Object.entries(byScope)) out[label][scope] = [...lines];
  }
  return out;
}
