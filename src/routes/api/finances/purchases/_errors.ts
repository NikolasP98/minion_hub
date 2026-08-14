import { json } from '@sveltejs/kit';
import { PurchasesError } from '$server/services/purchases.service';

// Mirrors src/routes/api/pos/_errors.ts — the purchases wire contract is the
// same `{error, code}` shape a thrown PosError-style error normally gets.
const STATUS_BY_CODE: Record<string, number> = {
  period_closed: 409,
  no_source: 409,
  no_credentials: 409,
  invalid_source: 409,
  invalid_input: 400,
};

/** Maps a PurchasesError to an `{error, code}` json Response (caller must RETURN it); re-throws anything else untouched. */
export function handlePurchasesError(e: unknown): Response {
  if (e instanceof PurchasesError) {
    return json({ error: e.message, code: e.code }, { status: STATUS_BY_CODE[e.code] ?? 400 });
  }
  throw e;
}
