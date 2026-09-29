/**
 * i18n labels + icons for the filter operator vocabulary in `filters.ts`.
 * Split out from the model module so it can import Paraglide messages
 * without pulling i18n into the (framework-agnostic) matching logic.
 */
import { Calendar, CheckSquare, Hash, List, Type } from 'lucide-svelte';
import * as m from '$lib/paraglide/messages';
import {
  defaultOp,
  isFilterActive,
  type FilterKind,
  type FilterValue,
  type RelativeDate,
} from './filters';

const OP_LABEL: Record<string, () => string> = {
  contains: () => m.data_table_filter_op_contains(),
  not_contains: () => m.data_table_filter_op_not_contains(),
  starts_with: () => m.data_table_filter_op_starts_with(),
  ends_with: () => m.data_table_filter_op_ends_with(),
  is: () => m.data_table_filter_op_is(),
  is_not: () => m.data_table_filter_op_is_not(),
  is_empty: () => m.data_table_filter_op_is_empty(),
  is_not_empty: () => m.data_table_filter_op_is_not_empty(),
  eq: () => m.data_table_filter_op_eq(),
  neq: () => m.data_table_filter_op_neq(),
  gt: () => m.data_table_filter_op_gt(),
  gte: () => m.data_table_filter_op_gte(),
  lt: () => m.data_table_filter_op_lt(),
  lte: () => m.data_table_filter_op_lte(),
  between: () => m.data_table_filter_op_between(),
  before: () => m.data_table_filter_op_before(),
  after: () => m.data_table_filter_op_after(),
  on_or_before: () => m.data_table_filter_op_on_or_before(),
  on_or_after: () => m.data_table_filter_op_on_or_after(),
  relative: () => m.data_table_filter_op_relative(),
  checked: () => m.data_table_filter_op_checked(),
  unchecked: () => m.data_table_filter_op_unchecked(),
};

/** Label for one operator (kind-independent vocabulary; `kind` reserved for future disambiguation). */
export function opLabel(_kind: FilterKind, op: string): string {
  return OP_LABEL[op]?.() ?? op;
}

const REL_LABEL: Record<RelativeDate, () => string> = {
  today: () => m.data_table_filter_rel_today(),
  yesterday: () => m.data_table_filter_rel_yesterday(),
  tomorrow: () => m.data_table_filter_rel_tomorrow(),
  this_week: () => m.data_table_filter_rel_this_week(),
  past_week: () => m.data_table_filter_rel_past_week(),
  past_month: () => m.data_table_filter_rel_past_month(),
  past_year: () => m.data_table_filter_rel_past_year(),
  next_week: () => m.data_table_filter_rel_next_week(),
  next_month: () => m.data_table_filter_rel_next_month(),
};

export function relLabel(rel: RelativeDate): string {
  return REL_LABEL[rel]();
}

export function kindIcon(kind: FilterKind) {
  switch (kind) {
    case 'text':
      return Type;
    case 'number':
      return Hash;
    case 'date':
      return Calendar;
    case 'enum':
      return List;
    case 'boolean':
      return CheckSquare;
  }
}

function lowerFirst(s: string): string {
  return s.length ? s[0].toLowerCase() + s.slice(1) : s;
}

/** Notion-style chip summary text, e.g. `contains "foo"`, `> 100`, `between 1 and 5`, `is A, B`, `is empty`, `Checked`, `Past week`. */
export function summary(
  kind: FilterKind,
  value: FilterValue,
  options?: { value: string; label: string }[],
): string {
  if (value.kind === 'boolean') return opLabel('boolean', value.op);
  if (!isFilterActive(value)) return lowerFirst(opLabel(kind, defaultOp(kind)));

  const op = value.op ?? defaultOp(kind);
  if (op === 'is_empty' || op === 'is_not_empty') return lowerFirst(opLabel(kind, op));

  if (value.kind === 'enum') {
    const labels = value.values.map((v) => options?.find((o) => o.value === v)?.label ?? v);
    return `${lowerFirst(opLabel('enum', op))} ${labels.join(', ')}`;
  }
  if (value.kind === 'text') {
    return `${lowerFirst(opLabel('text', op))} "${value.text.trim()}"`;
  }
  if (value.kind === 'number') {
    if (op === 'between') {
      return `${lowerFirst(opLabel('number', 'between'))} ${value.min ?? '…'} ${m.data_table_filter_and()} ${value.max ?? '…'}`;
    }
    return `${lowerFirst(opLabel('number', op))} ${value.min ?? ''}`;
  }
  // date
  if (op === 'relative') return value.rel ? relLabel(value.rel) : opLabel('date', 'relative');
  if (op === 'between') {
    return `${lowerFirst(opLabel('date', 'between'))} ${value.min ?? '…'} ${m.data_table_filter_and()} ${value.max ?? '…'}`;
  }
  return `${lowerFirst(opLabel('date', op))} ${value.min ?? ''}`;
}
