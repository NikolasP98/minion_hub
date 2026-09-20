import { json } from '@sveltejs/kit';
import { PosError } from '$server/services/pos.service';

// Leading underscore = not a SvelteKit route module, just a shared helper for
// the pos API routes (parseBody handles input-shape errors via zod; this
// handles the service's business-rule errors). Mirrors stock/_errors.ts, but
// the pos wire contract UI tasks depend on is `{error, code}` (not
// SvelteKit's default `{message}` from the `error()` helper), so this RETURNS
// a json Response the handler must `return` — SvelteKit's render_endpoint
// only special-cases thrown Redirects; a thrown plain Response becomes a 500.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  no_open_shift: 409,
  booking_already_billed: 409,
  booking_not_chargeable: 409,
  booking_payment_timing: 409,
  booking_has_plan: 409,
  duplicate_booking: 409,
  booking_customer_not_found: 404,
  booking_not_found: 404,
  booking_customer_mismatch: 409,
  booking_product_mismatch: 409,
  booking_retry_mismatch: 409,
  shift_already_open: 409,
  shift_closed: 409,
  already_void: 409,
  reconciled: 409,
  duplicate_source: 409,
  // packages / plans / client credit (spec 2026-09-13-pos-scheduling-packages-
  // payment-plans-spec.md §3) — all "the row exists, the state forbids it".
  insufficient_credit: 409,
  package_in_use: 409,
  package_exhausted: 409,
  package_expired: 409,
  package_cancelled: 409,
  redemption_already_billed: 409,
  plan_settled: 409,
  plan_cancelled: 409,
  // the line exists, another booking already claimed it
  line_already_scheduled: 409,
  // book-and-link (POST /api/pos/tickets/:id/schedule) refusals
  ticket_void: 409,
  line_not_service: 400,
  slot_unavailable: 409,
  // seedShadowSeries (pos-emission.service.ts) belt-and-suspenders: the row
  // exists (an active serie already covers this org/doc_type/environment),
  // the state forbids a second one — same "exists, forbidden" class as the
  // package/plan 409s above.
  series_conflict: 409,
  // submitTicket preflight refusal (F-partial-stock-shortfall): a tracked
  // line lacks stock and the caller didn't pass allowNegativeStock.
  insufficient_stock: 409,
};

/** Maps a PosError to an `{error, code}` json Response (caller must RETURN it); re-throws anything else untouched. */
export function handlePosError(e: unknown): Response {
  if (e instanceof PosError) {
    return json(
      { error: e.message, code: e.code, ...(e.items ? { items: e.items } : {}) },
      { status: STATUS_BY_CODE[e.code] ?? 400 },
    );
  }
  throw e;
}
