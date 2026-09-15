import { error } from '@sveltejs/kit';
import { PosError } from '$server/services/pos.service';

// Leading underscore = not a SvelteKit route module, just a shared helper for
// the scheduling API routes. Booking against a package grant calls into the POS
// package service, so its PosError codes have to reach the client with a status
// the booking UI can branch on (spec §3.2: 409 package_exhausted /
// package_expired). The pos API's own `_errors.ts` returns the `{error, code}`
// body the POS UI expects; scheduling routes speak SvelteKit's thrown `error()`,
// so this maps into that shape instead of importing across the two contracts.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  package_exhausted: 409,
  package_expired: 409,
  package_cancelled: 409,
  client_required: 400,
};

/** Re-throws a PosError as a SvelteKit HttpError; anything else passes through
 *  untouched (the caller's `catch` must rethrow). */
export function rethrowPosError(e: unknown): never {
  if (e instanceof PosError) throw error(STATUS_BY_CODE[e.code] ?? 400, e.code);
  throw e;
}
