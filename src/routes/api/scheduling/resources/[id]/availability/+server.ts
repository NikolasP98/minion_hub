import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  ensureResourceSchedule,
  getResourceSchedule,
  replaceAvailability,
} from '$server/services/scheduling.service';

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
  await requireOrgCapability(locals, 'scheduling', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, putSchema);
  // A resource without a schedule row gets one here rather than a 404, so the
  // editor works for every resource, not only those seeded by createResource.
  const schedule = await ensureResourceSchedule(ctx, params.id!).catch(() => null);
  if (!schedule) throw error(404, 'resource not found');
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
