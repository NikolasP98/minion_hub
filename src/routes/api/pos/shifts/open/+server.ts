import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { openShift } from '$server/services/pos.service';
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
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const shift = await openShift(ctx, { openingFloat: body.openingFloat, actor });
    return json({ ok: true, shift });
  } catch (e) {
    return handlePosError(e);
  }
};
