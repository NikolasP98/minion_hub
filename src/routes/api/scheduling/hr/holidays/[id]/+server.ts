import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { deleteHoliday, updateHoliday } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../../_shared';

const patchSchema = z.union([
  z.object({ deleted: z.literal(true) }),
  z
    .object({
      enabled: z.boolean().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      name: z.string().trim().min(1).max(200).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'empty patch'),
]);

/**
 * PATCH { deleted: true } | { enabled?, date?, name? } — every holiday edit
 * rides on scheduling:edit (hrms treats holiday-list edits as one permission);
 * the write hook maps DELETE to scheduling:delete, which coordinators may not hold.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, patchSchema);
  return hrTry(async () => {
    if ('deleted' in b) {
      await deleteHoliday(ctx, params.id!);
      return { ok: true };
    }
    return { holiday: await updateHoliday(ctx, params.id!, b) };
  });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => {
    await deleteHoliday(ctx, params.id!);
    return { ok: true };
  });
};
