import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { listHolidays, upsertHoliday, importCountryHolidays } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const postSchema = z.union([
  z.object({ date: DATE, name: z.string().trim().min(1).max(200) }),
  // Nager.Date import for one country-year; rows arrive enabled and are toggled, never retyped.
  z.object({
    import: z.object({
      country: z.string().regex(/^[A-Z]{2}$/),
      year: z.number().int().min(2000).max(2100),
    }),
  }),
]);

/** GET /api/scheduling/hr/holidays[?from&to] — stored holidays (weekly offs live in /settings). */
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

/** POST — one manual holiday (upsert by date) or a country import. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () =>
    'date' in b
      ? { holiday: await upsertHoliday(ctx, b) }
      : await importCountryHolidays(ctx, b.import.country, b.import.year),
  );
};
