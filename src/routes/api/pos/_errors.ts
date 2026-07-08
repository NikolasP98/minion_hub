import { json } from '@sveltejs/kit';
import { PosError } from '$server/services/pos.service';

// Leading underscore = not a SvelteKit route module, just a shared helper for
// the pos API routes (parseBody handles input-shape errors via zod; this
// handles the service's business-rule errors). Mirrors stock/_errors.ts, but
// the pos wire contract UI tasks depend on is `{error, code}` (not
// SvelteKit's default `{message}` from the `error()` helper), so this throws
// a Response directly instead.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  no_open_shift: 409,
  shift_already_open: 409,
  shift_closed: 409,
  already_void: 409,
  reconciled: 409,
  duplicate_source: 409,
};

/** Maps a PosError to the right HTTP error `{error, code}` body; re-throws anything else untouched. */
export function handlePosError(e: unknown): never {
  if (e instanceof PosError) {
    throw json({ error: e.message, code: e.code }, { status: STATUS_BY_CODE[e.code] ?? 400 });
  }
  throw e;
}
