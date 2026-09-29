/**
 * Column-filter values for the shared DataTable — Notion-style basic filters
 * (one operator-aware rule per column) plus an advanced And/Or rule tree over
 * any column.
 *
 * `op` absent on a `FilterValue` means the historical default operator for
 * that kind (enum `is`, text `contains`, number/date `between`) — every
 * pre-existing literal and `filterToParam` consumer keeps working unchanged.
 * `boolean` is new: its `op` is required because the operator IS the value
 * (no separate operand).
 *
 * Lives in its own module so the filter popover and the table can share the
 * type without an import cycle.
 */

export type TextOp =
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is'
  | 'is_not'
  | 'is_empty'
  | 'is_not_empty';
export type NumberOp =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_empty' | 'is_not_empty';
export type DateOp =
  | 'is'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'between'
  | 'relative'
  | 'is_empty'
  | 'is_not_empty';
export type RelativeDate =
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'this_week'
  | 'past_week'
  | 'past_month'
  | 'past_year'
  | 'next_week'
  | 'next_month';
/** `is` = any of `values`. */
export type EnumOp = 'is' | 'is_not' | 'is_empty' | 'is_not_empty';
export type BooleanOp = 'checked' | 'unchecked';

export type FilterValue =
  | { kind: 'enum'; op?: EnumOp; values: string[] }
  | { kind: 'text'; op?: TextOp; text: string }
  | { kind: 'number'; op?: NumberOp; min: number | null; max: number | null }
  | { kind: 'date'; op?: DateOp; min: string | null; max: string | null; rel?: RelativeDate }
  | { kind: 'boolean'; op: BooleanOp };

export type FilterKind = FilterValue['kind'];

// TODO(handoff): adding the `boolean` variant makes DataTable.svelte's
// `filterSummary()` (around line 1456: `value.min`/`value.max` in its
// `default` switch branch) fail to type-check — that branch now also catches
// `boolean`, which has neither field. Stage 1A intentionally does not edit
// DataTable.svelte (spec 2026-09-29-hub-table-toolbar-notion-filters-spec.md,
// Stage 1A scope); Stage 2 wiring replaces `filterSummary` with
// `filter-ops.ts`'s `summary()` anyway, so fix it there (or narrow out
// `'boolean'` first) before merging feat/table-toolbar-filters.

/** One rule in an advanced filter tree: a single column op+operand. */
export interface FilterRule {
  id: string;
  key: string;
  value: FilterValue;
}
/** A group of rules and/or nested groups, combined with one logic operator. */
export interface FilterGroup {
  id: string;
  logic: 'and' | 'or';
  items: Array<FilterRule | FilterGroup>;
}

export function isFilterGroup(item: FilterRule | FilterGroup): item is FilterGroup {
  return 'logic' in item;
}

/** Column metadata the filter menu / advanced builder need to describe a column. */
export interface FilterColumnMeta {
  key: string;
  label: string;
  kind: FilterKind;
  options?: { value: string; label: string }[];
}

/** A stable-enough id for rule/group tree nodes (client-side only). */
export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return (
    c?.randomUUID?.() ?? `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  );
}

/** The default (legacy) operator for a kind — what an absent `op` means. */
export function defaultOp(kind: FilterKind): string {
  switch (kind) {
    case 'enum':
      return 'is';
    case 'text':
      return 'contains';
    case 'number':
      return 'between';
    case 'date':
      return 'between';
    case 'boolean':
      return 'checked';
  }
}

/** Every operator a kind supports, in menu order. */
export function opsFor(kind: FilterKind): string[] {
  switch (kind) {
    case 'text':
      return [
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'is',
        'is_not',
        'is_empty',
        'is_not_empty',
      ];
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'];
    case 'date':
      return [
        'is',
        'before',
        'after',
        'on_or_before',
        'on_or_after',
        'between',
        'relative',
        'is_empty',
        'is_not_empty',
      ];
    case 'enum':
      return ['is', 'is_not', 'is_empty', 'is_not_empty'];
    case 'boolean':
      return ['checked', 'unchecked'];
  }
}

/** Does this operator need an operand editor at all? `boolean`'s op IS the value. */
export function opNeedsOperand(kind: FilterKind, op: string): boolean {
  if (kind === 'boolean') return false;
  return op !== 'is_empty' && op !== 'is_not_empty';
}

/** The empty value for a kind — what "cleared" means. */
export function emptyFilter(kind: FilterKind): FilterValue {
  switch (kind) {
    case 'enum':
      return { kind: 'enum', values: [] };
    case 'text':
      return { kind: 'text', text: '' };
    case 'number':
      return { kind: 'number', min: null, max: null };
    case 'date':
      return { kind: 'date', min: null, max: null };
    case 'boolean':
      return { kind: 'boolean', op: 'checked' };
  }
}

/** A fresh rule on `key` with `kind`'s default operator and an inert operand. */
export function emptyRule(key: string, kind: FilterKind): FilterRule {
  const base = emptyFilter(kind);
  return { id: newId(), key, value: { ...base, op: defaultOp(kind) } as FilterValue };
}

/** A fresh empty And-group with no rules. */
export function emptyGroup(): FilterGroup {
  return { id: newId(), logic: 'and', items: [] };
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** An empty filter is inert — it must never narrow the view or raise a chip. */
export function isFilterActive(value: FilterValue | null | undefined): boolean {
  if (!value) return false;
  switch (value.kind) {
    case 'boolean':
      return true;
    case 'enum': {
      const op = value.op ?? 'is';
      if (op === 'is_empty' || op === 'is_not_empty') return true;
      return value.values.length > 0;
    }
    case 'text': {
      const op = value.op ?? 'contains';
      if (op === 'is_empty' || op === 'is_not_empty') return true;
      return value.text.trim().length > 0;
    }
    case 'number': {
      const op = value.op ?? 'between';
      if (op === 'is_empty' || op === 'is_not_empty') return true;
      if (op === 'between') return value.min != null || value.max != null;
      return value.min != null;
    }
    case 'date': {
      const op = value.op ?? 'between';
      if (op === 'is_empty' || op === 'is_not_empty') return true;
      if (op === 'relative') return value.rel != null;
      if (op === 'between') return value.min != null || value.max != null;
      return value.min != null;
    }
  }
}

function inRange(n: number, min: number | null, max: number | null): boolean {
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

/** `YYYY-MM-DD` for a Date or a date-ish string; `null` when it isn't one. */
export function dayString(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'string' && v.trim()) return v.slice(0, 10);
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function subMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() - n);
  return r;
}
function subYears(d: Date, n: number): Date {
  const r = new Date(d);
  r.setFullYear(r.getFullYear() - n);
  return r;
}
function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=Sun..6=Sat
  return addDays(d, day === 0 ? -6 : 1 - day);
}
function fmtLocalDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `[from, to]` (both `YYYY-MM-DD`, inclusive) for a relative date window,
 * computed in LOCAL time from `now`. `this_week` is Mon..Sun; `past_week` /
 * `past_month` / `past_year` are the N days ending today (today included);
 * `next_week` / `next_month` are the 7 / 30 days after today.
 */
export function relativeWindow(rel: RelativeDate, now: Date): [string, string] {
  const today = startOfDay(now);
  switch (rel) {
    case 'today':
      return [fmtLocalDay(today), fmtLocalDay(today)];
    case 'yesterday': {
      const d = addDays(today, -1);
      return [fmtLocalDay(d), fmtLocalDay(d)];
    }
    case 'tomorrow': {
      const d = addDays(today, 1);
      return [fmtLocalDay(d), fmtLocalDay(d)];
    }
    case 'this_week': {
      const mon = mondayOf(today);
      return [fmtLocalDay(mon), fmtLocalDay(addDays(mon, 6))];
    }
    case 'past_week':
      return [fmtLocalDay(addDays(today, -6)), fmtLocalDay(today)];
    case 'past_month':
      return [fmtLocalDay(addDays(subMonths(today, 1), 1)), fmtLocalDay(today)];
    case 'past_year':
      return [fmtLocalDay(addDays(subYears(today, 1), 1)), fmtLocalDay(today)];
    case 'next_week':
      return [fmtLocalDay(addDays(today, 1)), fmtLocalDay(addDays(today, 7))];
    case 'next_month':
      return [fmtLocalDay(addDays(today, 1)), fmtLocalDay(addDays(today, 30))];
  }
}

/**
 * Does one row's matched value satisfy the filter? `raw` is whatever the
 * column's `filter.match` (or accessor) produced: a scalar, or an array when
 * a row can belong to several buckets at once. `now` is injectable so
 * relative-date windows are pinnable in tests.
 */
export function matchesFilter(value: FilterValue, raw: unknown, now: Date = new Date()): boolean {
  if (!isFilterActive(value)) return true;
  const list = Array.isArray(raw) ? raw : [raw];

  switch (value.kind) {
    case 'enum': {
      const op = value.op ?? 'is';
      if (op === 'is_empty') return list.every(isEmptyValue);
      if (op === 'is_not_empty') return list.some((v) => !isEmptyValue(v));
      const set = new Set(value.values);
      const hit = list.some((v) => v != null && set.has(String(v)));
      return op === 'is_not' ? !hit : hit;
    }
    case 'text': {
      const op = value.op ?? 'contains';
      if (op === 'is_empty') return list.every(isEmptyValue);
      if (op === 'is_not_empty') return list.some((v) => !isEmptyValue(v));
      const needle = value.text.trim().toLowerCase();
      const test = (v: unknown) => {
        if (v == null) return false;
        const s = String(v).toLowerCase();
        switch (op) {
          case 'contains':
            return s.includes(needle);
          case 'not_contains':
            return !s.includes(needle);
          case 'starts_with':
            return s.startsWith(needle);
          case 'ends_with':
            return s.endsWith(needle);
          case 'is':
            return s === needle;
          case 'is_not':
            return s !== needle;
          default:
            return false;
        }
      };
      return list.some(test);
    }
    case 'number': {
      const op = value.op ?? 'between';
      if (op === 'is_empty') return list.every(isEmptyValue);
      if (op === 'is_not_empty') return list.some((v) => !isEmptyValue(v));
      const toNum = (v: unknown) => (typeof v === 'number' ? v : Number(v));
      if (op === 'between') {
        return list.some((v) => {
          const n = toNum(v);
          return Number.isFinite(n) && inRange(n, value.min, value.max);
        });
      }
      const operand = value.min;
      if (operand == null) return true;
      return list.some((v) => {
        const n = toNum(v);
        if (!Number.isFinite(n)) return false;
        switch (op) {
          case 'eq':
            return n === operand;
          case 'neq':
            return n !== operand;
          case 'gt':
            return n > operand;
          case 'gte':
            return n >= operand;
          case 'lt':
            return n < operand;
          case 'lte':
            return n <= operand;
          default:
            return false;
        }
      });
    }
    case 'date': {
      const op = value.op ?? 'between';
      if (op === 'is_empty') return list.every((v) => dayString(v) == null);
      if (op === 'is_not_empty') return list.some((v) => dayString(v) != null);
      if (op === 'relative') {
        if (!value.rel) return true;
        const [from, to] = relativeWindow(value.rel, now);
        return list.some((v) => {
          const d = dayString(v);
          return d != null && d >= from && d <= to;
        });
      }
      if (op === 'between') {
        return list.some((v) => {
          const d = dayString(v);
          if (!d) return false;
          if (value.min && d < value.min) return false;
          if (value.max && d > value.max) return false;
          return true;
        });
      }
      const operand = value.min;
      if (operand == null) return true;
      return list.some((v) => {
        const d = dayString(v);
        if (!d) return false;
        switch (op) {
          case 'is':
            return d === operand;
          case 'before':
            return d < operand;
          case 'after':
            return d > operand;
          case 'on_or_before':
            return d <= operand;
          case 'on_or_after':
            return d >= operand;
          default:
            return false;
        }
      });
    }
    case 'boolean': {
      const v = Array.isArray(raw) ? raw[0] : raw;
      return value.op === 'checked' ? v === true : v !== true;
    }
  }
}

/**
 * Recursively evaluates an advanced filter tree against one row. `matchOf`
 * resolves a column key to its accessor; an unknown key (or a `null`
 * accessor) never hides rows — same "inert" contract as a single filter.
 * An empty group (`and` or `or`, 0 items) matches everything.
 */
export function matchesGroup(
  group: FilterGroup,
  row: unknown,
  matchOf: (key: string) => ((row: unknown) => unknown) | null,
  now: Date = new Date(),
): boolean {
  if (group.items.length === 0) return true;
  const results = group.items.map((item) => {
    if (isFilterGroup(item)) return matchesGroup(item, row, matchOf, now);
    const accessor = matchOf(item.key);
    if (!accessor) return true;
    return matchesFilter(item.value, accessor(row), now);
  });
  return group.logic === 'and' ? results.every(Boolean) : results.some(Boolean);
}

function legacyParam(value: FilterValue): string {
  switch (value.kind) {
    case 'enum':
      return value.values.join(',');
    case 'text':
      return value.text.trim();
    case 'number':
      return `${value.min ?? ''}~${value.max ?? ''}`;
    case 'date':
      if (value.op === 'relative') return value.rel ?? '';
      return `${value.min ?? ''}~${value.max ?? ''}`;
    case 'boolean':
      return value.op;
  }
}

/**
 * One filter as a single query-string value for server mode. `op` absent (or
 * equal to the kind's default) keeps the historical encoding unchanged; any
 * other operator is prefixed `op:<payload>` — server consumers don't parse
 * that prefix yet (ledger item #1), so non-default ops are hidden in server
 * mode at the caller.
 */
export function filterToParam(value: FilterValue): string {
  const op = value.op ?? defaultOp(value.kind);
  const payload = legacyParam(value);
  return op === defaultOp(value.kind) ? payload : `${op}:${payload}`;
}
