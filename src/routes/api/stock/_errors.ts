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
  default_warehouse: 409,
  has_stock: 409,
  has_children: 409,
};

/** Maps a StockError to the right HTTP error; re-throws anything else untouched.
 *  `code` rides along on the body so callers that need to distinguish sibling
 *  409s (e.g. the three warehouse-archive guards) don't have to string-match
 *  the message. */
export function handleStockError(e: unknown): never {
  if (e instanceof StockError)
    throw error(STATUS_BY_CODE[e.code] ?? 400, { message: e.message, code: e.code });
  throw e;
}
