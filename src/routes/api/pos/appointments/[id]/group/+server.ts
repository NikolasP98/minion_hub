import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { groupBookingResponse } from '../../../../scheduling/bookings/_handlers';

/**
 * POST /api/pos/appointments/[id]/group — merged visits for the POS calendar
 * (owner ask 2026-09-25: dragging an event onto another one for the same client
 * and team member joins them into a single block; a settings action separates
 * them again). Body shapes + the merge/detach/move dispatch live in the shared
 * `groupBookingResponse` (`../../../../scheduling/bookings/_handlers`), which
 * also backs the `scheduling:edit`-gated twin at
 * `/api/scheduling/bookings/[id]/group` — this route only keeps its own POS
 * auth + module + capability gate in front of it.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  await requireOrgCapability(locals, 'pos', 'edit');

  return groupBookingResponse(ctx, locals, request, params.id!);
};
