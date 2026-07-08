import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getOpenShift } from '$server/services/pos.service';

/** GET /api/pos/shifts/current — `{shift, summary}` or `{shift: null}`. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  const open = await getOpenShift(ctx);
  return json(open ?? { shift: null });
};
