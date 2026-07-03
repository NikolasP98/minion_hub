import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getResourceSchedule, replaceAvailability } from '$server/services/scheduling.service';

// rules items are a loose JSON blob — kept as z.unknown() per plan; per-item
// shape is validated below exactly as before.
const putSchema = z.object({
  timezone: z.string().max(100).optional(),
  rules: z.array(z.unknown()).optional(),
});

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ schedule: await getResourceSchedule(ctx, params.id!) });
};

export const PUT: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, putSchema);
  const schedule = await getResourceSchedule(ctx, params.id!);
  if (!schedule) throw error(404, 'no schedule for resource');
  const rules = Array.isArray(b.rules) ? (b.rules as Array<Record<string, unknown>>) : [];
  await replaceAvailability(
    ctx,
    schedule.scheduleId,
    typeof b.timezone === 'string' ? b.timezone : schedule.timezone,
    rules.map((r) => ({
      days: Array.isArray(r.days) ? r.days.map(Number) : [],
      startTime: String(r.startTime ?? '09:00'),
      endTime: String(r.endTime ?? '17:00'),
      date: r.date ? String(r.date) : null,
    })),
  );
  return json({ ok: true });
};
