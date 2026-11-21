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
