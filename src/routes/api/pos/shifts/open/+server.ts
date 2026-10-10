import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getUserNames } from '$server/services/user.service';
import { listOpenShifts, openShift } from '$server/services/pos.service';
import { handlePosError } from '../../_errors';

const postSchema = z.object({
  openingFloat: z.record(z.string(), z.number().finite()),
});

/** POST /api/pos/shifts/open */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, postSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const shift = await openShift(ctx, { openingFloat: body.openingFloat, actor });
    return json({ ok: true, shift });
  } catch (e) {
    return handlePosError(e);
  }
};

/**
 * GET /api/pos/shifts/open — every open shift in the org (who, since when).
 * Shifts are per user, so this is how a cashier sees that a colleague's
 * register is still open. Read-only, hence an explicit `pos: view` gate (the
 * central write guard only covers mutating methods).
 */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'view');
  const shifts = await listOpenShifts(ctx);
  const names = await getUserNames(shifts.map((s) => s.openedBy));
  return json({
    shifts: shifts.map((s) => ({
      id: s.id,
      openedBy: s.openedBy,
      openedByName: (s.openedBy && names.get(s.openedBy)) || null,
      openedAt: s.openedAt,
    })),
  });
};
