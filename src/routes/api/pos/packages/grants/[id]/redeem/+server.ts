import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { redeemSession } from '$server/services/pos-packages.service';
import { handlePosError } from '../../../../_errors';

/**
 * POST /api/pos/packages/grants/:id/redeem — draw one session AT THE COUNTER.
 *
 * Spec §3.2 draws a session at BOOKING time, which leaves the walk-in who owns
 * sessions but has no appointment unservable at the till (proposals §19). This
 * is the counter entry point for exactly that: same grant lock, same
 * exhaustion / expiry / cancellation 409s as the booking path, no `bookingId`.
 *
 * `pos:edit` — drawing a session spends something the client paid for, but it
 * is ordinary till work, not the manager-grade money-minting that
 * /api/pos/accounts/topup does. The central `apiWriteCapability` gate already
 * resolves /api/pos + POST to `pos:edit`; this states it at the handler too,
 * the way every other POS write route does.
 *
 * TODO(handoff): the session is drawn when the cashier clicks, not when the
 * ticket commits, so an ABANDONED cart leaves a drawn-but-unbilled redemption
 * and the client is one session short until someone reverses it — there is no
 * reversal endpoint yet. `/pos/sell` reuses an existing unbilled redemption
 * before minting a new one, so the common "abandon, then re-ring" path costs
 * nothing. See meta proposals/2026-09-13-pos-packages-plans-s1-followups.md §24.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  try {
    const redemption = await redeemSession(ctx, {
      grantId: params.id as string,
      actor: {
        id: ctx.profileId ?? null,
        name: locals.user?.displayName ?? locals.user?.email ?? null,
      },
    });
    return json({ ok: true, redemption }, { status: 201 });
  } catch (e) {
    return handlePosError(e);
  }
};
