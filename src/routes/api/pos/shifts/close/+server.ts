import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { closeShift } from '$server/services/pos.service';
import { handlePosError } from '../../_errors';

const postSchema = z.object({
  counted: z.record(z.string(), z.number().finite()),
  note: z.string().max(20_000).nullable().optional(),
});

/** POST /api/pos/shifts/close */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const shift = await closeShift(ctx, { counted: body.counted, note: body.note ?? null, actor });
    return json({ ok: true, shift });
  } catch (e) {
    handlePosError(e);
  }
};
