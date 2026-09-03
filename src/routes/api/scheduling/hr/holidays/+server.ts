import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { listHolidays, upsertHoliday, materializeWeeklyOff } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const postSchema = z.union([
  z.object({
    date: DATE,
    name: z.string().trim().min(1).max(200),
    weeklyOff: z.boolean().optional(),
  }),
  // hrms get_weekly_off_dates: materialise weekly offs for a range.
  z.object({ weeklyOff: z.array(z.number().int().min(0).max(6)).min(1), from: DATE, to: DATE }),
]);

/** GET /api/scheduling/hr/holidays[?from&to] */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => ({
    holidays: await listHolidays(
      ctx,
      url.searchParams.get('from') ?? undefined,
      url.searchParams.get('to') ?? undefined,
    ),
  }));
};

/** POST — one holiday (upsert by date) or a weekly-off materialisation. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () =>
    'date' in b
      ? { holiday: await upsertHoliday(ctx, b) }
      : { created: await materializeWeeklyOff(ctx, b.weeklyOff, b.from, b.to) },
  );
};
