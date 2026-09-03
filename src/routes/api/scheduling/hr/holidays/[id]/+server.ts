import type { RequestHandler } from '@sveltejs/kit';
import { deleteHoliday } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../../_shared';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => {
    await deleteHoliday(ctx, params.id!);
    return { ok: true };
  });
};
