import * as m from '$lib/paraglide/messages';
import { appLocale } from '$lib/utils/format';
import type { ExchangeErrorCode } from '$lib/stock/entry-legs';

/** The form's own sentence for a canje rule (spec 142). */
export function exchangeErrorText(code: ExchangeErrorCode): string {
  return code === 'exchange_party_required'
    ? m.stock_exchange_party_required()
    : code === 'exchange_needs_both_sides'
      ? m.stock_exchange_needs_both_sides()
      : m.stock_exchange_item_both_sides();
}

export type StockRefusal = { title: string; detail?: string; itemId?: string };

const EXCHANGE_CODES = new Set<string>([
  'exchange_party_required',
  'exchange_needs_both_sides',
  'exchange_item_both_sides',
]);

/**
 * A stock API refusal (`{ message, code, details }`) as the user reads it. A
 * canje shortage names the product, what is on hand and what the canje gives;
 * anything unrecognised keeps the server's message.
 */
export function stockRefusal(body: App.Error | null, type: string): StockRefusal {
  const d = body?.details;
  const qty = (v: unknown) => Number(v).toLocaleString(appLocale(), { maximumFractionDigits: 2 });
  if (type === 'exchange' && body?.code === 'negative_stock' && d)
    return {
      title: m.stock_exchange_shortage_title({ item: String(d.item) }),
      detail: m.stock_exchange_shortage_detail({
        onHand: qty(d.onHand),
        requested: qty(d.requested),
      }),
      itemId: String(d.itemId),
    };
  if (body?.code && EXCHANGE_CODES.has(body.code))
    return { title: exchangeErrorText(body.code as ExchangeErrorCode) };
  return { title: body?.message ?? m.stock_submit_failed() };
}
