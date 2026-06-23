import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { reconcileParties } from '$server/services/party.service';

/** POST /api/crm/parties/reconcile — backfill/relink the party spine for this
 *  org. Idempotent set-based pass over crm_contacts + fin_clients + bookings.
 *  Doubles as the one-off backfill for pre-existing rows and a manual re-link. */
export const POST: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await reconcileParties(ctx);
  return json({ ok: true });
};
