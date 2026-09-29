/**
 * URL-mirrored table state — one owner for `replaceState`.
 *
 * Seven pages hand-roll this today (spec 2026-09-28 §T2, inventory §4):
 * `crm/customers` (`q`/`sort`/`dir`/enum filters/`page`), `pos/sell` (`step`),
 * `socials/campaigns` (`from`/`to`), `finances/invoices` (`discounted`),
 * `pos/accounts` (`client`), `team/PeopleView` (`person`) and `stock/entries`
 * (`party`). Each one re-derives the same three moves: parse `page.url` on
 * init, serialize on change, keep unrelated params. This kit owns exactly the
 * generic table axes — search, sort, column filters, page, expanded rows —
 * and nothing page-specific: a step, a date range, a drawer key or a scope
 * filter stays in its page, because those are not table state.
 *
 * Parameter names (all prefixable, so two tables can share one URL):
 * | Field      | Param            | Encoding                                |
 * |------------|------------------|-----------------------------------------|
 * | `search`   | `<prefix>q`      | raw string                              |
 * | `sort`     | `<prefix>sort`   | `key:dir,key2:dir` (multi-sort ready)   |
 * | `filters`  | `<prefix>f.<col>`| `a,b,c` (enum) or `min..max` (range)    |
 * | `page`     | `<prefix>page`   | integer, omitted at 1                   |
 * | `expanded` | `<prefix>x`      | `id,id2`                                |
 *
 * ## The mirror runs from the CONSUMER's `$effect`
 *
 * A bare `$effect` (even inside `$effect.root`) never runs under this repo's
 * vitest harness — see the TODO(handoff) in
 * `src/lib/components/scheduling/kit/settled-day.svelte.test.ts`. A kit that
 * mirrored to the URL from its own internal `$effect` would therefore be
 * silently untested AND un-stoppable. So this kit writes only when `sync()` is
 * called, and the consumer mounts the mirror itself:
 *
 * ```svelte
 * const url = createTableUrlState({ keys: ['search', 'sort', 'filters'] });
 * $effect(() => url.sync()); // sync() reads every owned field ⇒ tracked
 * ```
 *
 * `sync()` deep-reads all owned fields synchronously (so the effect subscribes
 * to them), then queues ONE write per microtask — repeated calls in the same
 * tick collapse into the last one. A write that would not change the URL is
 * skipped, so the `page.url` read inside `sync()` cannot loop.
 *
 * Empty values (blank search, no sort, `{}` filters, page 1, no expanded ids)
 * delete their param instead of writing `&q=`. Every param this kit does not
 * own is carried through untouched, in place.
 */
import { page as appPage } from '$app/state';
import { goto, replaceState } from '$app/navigation';

export type TableSort = { key: string; dir: 'asc' | 'desc' };
export type TableFilterRange = { min?: string; max?: string };
/**
 * A column filter. `string[]` = enum selection, `{min,max}` = a numeric/date
 * range. A bare `string` is accepted on write (serialized verbatim, for a
 * `contains` text filter) but parsing never PRODUCES one — `f.name=ana` comes
 * back as `['ana']`, since the URL cannot tell a one-item list from a string.
 */
export type TableFilterValue = string[] | TableFilterRange | string;

export type TableUrlStateKey = 'search' | 'sort' | 'filters' | 'page' | 'expanded';

export type TableUrlStateOptions = {
  /** Which axes this table mirrors. Anything omitted is never read or written. */
  keys: TableUrlStateKey[];
  /** Prepended to every param name, so two tables can share one URL. */
  prefix?: string;
  /** `true` (default) = shallow `replaceState`, no load re-run. `false` = `goto`. */
  replace?: boolean;
};

export interface TableUrlState {
  search: string;
  sort: TableSort[];
  filters: Record<string, TableFilterValue>;
  page: number;
  expanded: string[];
  /** Read every owned field and queue one coalesced URL write. */
  sync(): void;
  /** Reset every owned field to empty and sync. */
  clear(): void;
}

const RANGE_SEP = '..';

const list = (raw: string | null): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function parseSort(raw: string | null): TableSort[] {
  return list(raw)
    .map((part) => {
      const sep = part.indexOf(':');
      const key = (sep === -1 ? part : part.slice(0, sep)).trim();
      return { key, dir: part.slice(sep + 1) === 'desc' ? 'desc' : 'asc' } as TableSort;
    })
    .filter((s) => Boolean(s.key));
}

function serializeSort(sort: TableSort[]): string {
  return sort
    .filter((s) => s?.key)
    .map((s) => `${s.key}:${s.dir === 'desc' ? 'desc' : 'asc'}`)
    .join(',');
}

/**
 * `min..max` ⇒ a range, anything else ⇒ a comma list. A list item containing
 * `..` is therefore read back as a range — the documented ceiling of a
 * separator-based encoding; no table filters on such a value today.
 */
function parseFilterValue(raw: string): TableFilterValue | null {
  const sep = raw.indexOf(RANGE_SEP);
  if (sep !== -1) {
    const min = raw.slice(0, sep).trim();
    const max = raw.slice(sep + RANGE_SEP.length).trim();
    if (!min && !max) return null;
    return { ...(min ? { min } : {}), ...(max ? { max } : {}) };
  }
  const values = list(raw);
  return values.length ? values : null;
}

function serializeFilterValue(value: TableFilterValue): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.filter(Boolean).join(',');
  const min = value.min?.trim() ?? '';
  const max = value.max?.trim() ?? '';
  return min || max ? `${min}${RANGE_SEP}${max}` : '';
}

class TableUrlStateImpl implements TableUrlState {
  search = $state('');
  sort = $state<TableSort[]>([]);
  filters = $state<Record<string, TableFilterValue>>({});
  page = $state(1);
  expanded = $state<string[]>([]);

  readonly #keys: Set<TableUrlStateKey>;
  readonly #prefix: string;
  readonly #replace: boolean;
  #queued = false;
  #pending: string | null = null;

  constructor(opts: TableUrlStateOptions) {
    this.#keys = new Set(opts.keys);
    this.#prefix = opts.prefix ?? '';
    this.#replace = opts.replace ?? true;

    const p = appPage.url.searchParams;
    if (this.#keys.has('search')) this.search = p.get(this.#name('q')) ?? '';
    if (this.#keys.has('sort')) this.sort = parseSort(p.get(this.#name('sort')));
    if (this.#keys.has('filters')) {
      const fp = this.#name('f.');
      const parsed: Record<string, TableFilterValue> = {};
      for (const [name, raw] of p.entries()) {
        if (!name.startsWith(fp)) continue;
        const column = name.slice(fp.length);
        const value = parseFilterValue(raw);
        if (column && value) parsed[column] = value;
      }
      this.filters = parsed;
    }
    if (this.#keys.has('page')) {
      const n = Number(p.get(this.#name('page')));
      this.page = Number.isFinite(n) && n > 1 ? Math.floor(n) : 1;
    }
    if (this.#keys.has('expanded')) this.expanded = list(p.get(this.#name('x')));
  }

  #name(param: string): string {
    return `${this.#prefix}${param}`;
  }

  /** Current field values folded over the live URL ⇒ the target `path?search`. */
  #target(): string {
    const p = new URLSearchParams(appPage.url.search);
    const set = (param: string, value: string) => {
      const name = this.#name(param);
      if (value) p.set(name, value);
      else p.delete(name);
    };
    if (this.#keys.has('search')) set('q', this.search.trim());
    if (this.#keys.has('sort')) set('sort', serializeSort(this.sort));
    if (this.#keys.has('filters')) {
      const fp = this.#name('f.');
      for (const name of [...p.keys()]) if (name.startsWith(fp)) p.delete(name);
      for (const [column, value] of Object.entries(this.filters)) {
        const raw = serializeFilterValue(value);
        if (column && raw) p.set(`${fp}${column}`, raw);
      }
    }
    if (this.#keys.has('page')) set('page', this.page > 1 ? String(Math.floor(this.page)) : '');
    if (this.#keys.has('expanded')) set('x', this.expanded.filter(Boolean).join(','));
    const search = p.toString();
    return search ? `${appPage.url.pathname}?${search}` : appPage.url.pathname;
  }

  sync(): void {
    // Built synchronously so a caller's `$effect` subscribes to every field.
    this.#pending = this.#target();
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      const target = this.#pending;
      this.#pending = null;
      if (target == null) return;
      if (target === `${appPage.url.pathname}${appPage.url.search}`) return;
      try {
        if (this.#replace) replaceState(target, {});
        else void goto(target, { replaceState: false, keepFocus: true, noScroll: true });
      } catch {
        // The FIRST sync can land before SvelteKit's router is initialized —
        // a consumer whose state does not match the URL at mount (a seeded
        // default sort, say) queues its write from a mount-time effect, and
        // `replaceState` throws there ("Cannot call replaceState(...) before
        // router is initialized"), as an UNCAUGHT error in this microtask.
        // The URL is a mirror, so dropping that one write is harmless: nothing
        // is remembered as written, and `#target()` folds the live URL again on
        // the next change, so the full state lands then.
      }
    });
  }

  clear(): void {
    if (this.#keys.has('search')) this.search = '';
    if (this.#keys.has('sort')) this.sort = [];
    if (this.#keys.has('filters')) this.filters = {};
    if (this.#keys.has('page')) this.page = 1;
    if (this.#keys.has('expanded')) this.expanded = [];
    this.sync();
  }
}

export function createTableUrlState(opts: TableUrlStateOptions): TableUrlState {
  return new TableUrlStateImpl(opts);
}
