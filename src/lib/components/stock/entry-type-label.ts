import * as m from '$lib/paraglide/messages';
import type { EntryType } from '$lib/stock/entry-legs';

const LABELS: Record<EntryType, () => string> = {
  receipt: m.stock_type_receipt,
  issue: m.stock_type_issue,
  transfer: m.stock_type_transfer,
  adjustment: m.stock_type_adjustment,
  exchange: m.stock_type_exchange,
};

/** Localized label of a stock-entry type; null for an unknown/legacy string. */
export function entryTypeLabel(type: string | null | undefined): string | null {
  return type && Object.hasOwn(LABELS, type) ? LABELS[type as EntryType]() : null;
}

/** A ledger row's label: a value-only row (qty 0) is the engine's valuation residual (spec 144). */
export function movementLabel(type: string | null | undefined, qtyDelta?: string): string {
  if (qtyDelta !== undefined && Number(qtyDelta) === 0) return m.stock_mv_kind_residual();
  return entryTypeLabel(type) ?? m.stock_mv_kind_unknown();
}
