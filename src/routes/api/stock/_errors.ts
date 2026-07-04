import { error } from '@sveltejs/kit';
import { StockError } from '$server/services/stock.service';

// Leading underscore = not a SvelteKit route module, just a shared helper for
// the stock API routes (parseBody handles input-shape errors via zod; this
// handles the service's business-rule errors).
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  not_draft: 409,
  not_submitted: 409,
  negative_stock: 409,
  no_ledger: 409,
  cycle: 409,
  invoice_not_found: 404,
  product_not_found: 404,
  duplicate_invoice: 409,
};

/** Maps a StockError to the right HTTP error; re-throws anything else untouched. */
export function handleStockError(e: unknown): never {
  if (e instanceof StockError) throw error(STATUS_BY_CODE[e.code] ?? 400, e.message);
  throw e;
}
