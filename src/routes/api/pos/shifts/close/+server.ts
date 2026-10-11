import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { closeShift, listOpenShifts } from '$server/services/pos.service';
import { handlePosError } from '../../_errors';

const postSchema = z.object({
  counted: z.record(z.string(), z.number().finite()),
  note: z.string().max(20_000).nullable().optional(),
  /** Close this shift instead of the caller's own one — needs `pos: manage`. */
  shiftId: z.string().uuid().optional(),
});

/**
 * POST /api/pos/shifts/close — counts and closes the CALLER's own register
 * (shifts are per user). `pos: edit` is enough for that (the central write
 * guard), the same capability that opens one; counting SOMEONE ELSE's
 * register is the privileged operation and requires `pos: manage` — the
 * action `defaultCaps` grants managers for exactly this ("register/session
 * close", rbac.service.ts).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const body = await parseBody(request, postSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  if (body.shiftId) {
    // An unknown/already-closed id lands here too: it is not provably the
    // caller's own shift, so it needs the manager capability before the
    // service answers `no_open_shift`.
    const target = (await listOpenShifts(ctx)).find((s) => s.id === body.shiftId);
    if (!target || target.openedBy !== actor.id)
      await requireOrgCapability(locals, 'pos', 'manage');
  }
  try {
    const shift = await closeShift(ctx, {
      counted: body.counted,
      note: body.note ?? null,
      actor,
      shiftId: body.shiftId,
    });
    return json({ ok: true, shift });
  } catch (e) {
    return handlePosError(e);
  }
};
