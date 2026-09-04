import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { getHrSettings, updateHrSettings } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const patchSchema = z.object({
  /** Recurring weekly off, 0=Sun…6=Sat (hrms weekly_off, as ONE rule instead of rows). */
  weeklyOff: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
});

/** GET /api/scheduling/hr/settings */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => ({ settings: await getHrSettings(ctx) }));
};

/** PATCH — partial update (gated scheduling:edit by the write hook). */
export const PATCH: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, patchSchema);
  return hrTry(async () => ({
    settings: await updateHrSettings(ctx, {
      ...b,
      weeklyOff: b.weeklyOff && [...new Set(b.weeklyOff)],
    }),
  }));
};
