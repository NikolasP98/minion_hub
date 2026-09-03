import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { deleteHoliday } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../../_shared';

async function remove(locals: App.Locals, id: string) {
  const ctx = await hrCtx(locals);
  return hrTry(async () => {
    await deleteHoliday(ctx, id);
    return { ok: true };
  });
}

/**
 * PATCH { deleted: true } — removing a holiday rides on scheduling:edit (hrms
 * treats holiday-list edits as one permission); the write hook maps DELETE to
 * scheduling:delete, which coordinators/owners may not hold.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await parseBody(request, z.object({ deleted: z.literal(true) }));
  return remove(locals, params.id!);
};

export const DELETE: RequestHandler = ({ locals, params }) => remove(locals, params.id!);
