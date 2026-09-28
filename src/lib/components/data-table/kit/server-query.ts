/**
 * `ServerQuery` ⇄ `URLSearchParams` codec for server-mode tables.
 *
 * Pure — no `page`, no fetch, no navigation. Generalised from the encoder half
 * of `crm/customers`' hand-rolled `buildParams` (spec 2026-09-28 §T2): the
 * API-SHAPED half (renaming to `RankFilters`, folding a temperature band into
 * a score range, `limit`/`offset`) stays in the page, because that is one
 * endpoint's contract, not a table contract.
 *
 * Wire format, same as that page's URL today:
 * `q`, `sort`, `dir`, one param per active filter column, `page` (omitted at
 * 1), `perPage` (omitted when 0). `map.sort` / `map.filters` rename table
 * column keys to the server's names; `paramsToServerQuery` inverts them, so
 * the pair round-trips under the same map.
 */
import type { ServerQuery } from '../DataTable.svelte';

export type ServerQueryMap = {
  /** Table sort key → server sort name. Unmapped keys pass through. */
  sort?: Record<string, string>;
  /** Table filter column → server param name. Unmapped columns pass through. */
  filters?: Record<string, string>;
};

/** Param names this codec owns; everything else on a parse is a filter. */
const RESERVED = new Set(['q', 'sort', 'dir', 'page', 'perPage']);

const invert = (m: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(m ?? {}).map(([from, to]) => [to, from]));

export function serverQueryToParams(q: ServerQuery, map?: ServerQueryMap): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search) p.set('q', q.search);
  if (q.sort?.key) {
    p.set('sort', map?.sort?.[q.sort.key] ?? q.sort.key);
    p.set('dir', q.sort.dir === 'asc' ? 'asc' : 'desc');
  }
  for (const [column, value] of Object.entries(q.filters ?? {})) {
    if (!value) continue;
    p.set(map?.filters?.[column] ?? column, value);
  }
  if (q.page > 1) p.set('page', String(Math.floor(q.page)));
  if (q.pageSize > 0) p.set('perPage', String(Math.floor(q.pageSize)));
  return p;
}

export function paramsToServerQuery(p: URLSearchParams, map?: ServerQueryMap): ServerQuery {
  const sortBack = invert(map?.sort);
  const filtersBack = invert(map?.filters);
  const sortName = p.get('sort');
  const pageNum = Number(p.get('page'));
  const perPage = Number(p.get('perPage'));
  const filters: Record<string, string> = {};
  for (const [name, value] of p.entries()) {
    if (RESERVED.has(name) || !value) continue;
    filters[filtersBack[name] ?? name] = value;
  }
  return {
    search: p.get('q') ?? '',
    // `dir` absent ⇒ desc, matching `crm/customers`' URL-seeded initial query.
    sort: sortName
      ? { key: sortBack[sortName] ?? sortName, dir: p.get('dir') === 'asc' ? 'asc' : 'desc' }
      : null,
    filters,
    page: Number.isFinite(pageNum) && pageNum > 1 ? Math.floor(pageNum) : 1,
    pageSize: Number.isFinite(perPage) && perPage > 0 ? Math.floor(perPage) : 0,
  };
}
