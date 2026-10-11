import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { unscheduleVisit } from '$server/services/scheduling-bookings.service';

/**
 * POST /api/pos/appointments/[id]/unschedule — "Desagendar" on the calendar's
 * event context menu (owner ask 2026-10-10: "unschedule/delete; conditional. If
 * the treatment(s) are paid for, then unschedule for items").
 *
 * A cancel alone would strand the money: the paid `pos_ticket_lines` would keep
 * pointing at a dead booking instead of returning to "Servicios pagados sin
 * agendar". So this verb releases those lines and cancels every service of the
 * event in ONE transaction — see `unscheduleVisit`.
 *
 * Its own verb rather than another `…/group` body shape because it is not
 * composition work: it reverses a sale's scheduling claim. `/api/pos` is in
 * `API_WRITE_PREFIXES`, so `apiWriteCapability` gates it centrally too; the
 * explicit `pos:edit` check mirrors the sibling `group` route.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  await requireOrgCapability(locals, 'pos', 'edit');

  const result = await unscheduleVisit(ctx, params.id!, {
    actor: {
      id: ctx.profileId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
    },
  });
  if (!result.found) throw error(404, 'booking not found');
  return json({ ok: true, ...result });
};
