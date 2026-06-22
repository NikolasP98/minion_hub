import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { listEventTypes, upsertEventType, parseScheduleRules } from '$server/services/scheduling.service';
import type { EventTypeInput } from '$server/services/scheduling.service';

function parseEventType(b: Record<string, unknown>): EventTypeInput {
  if (typeof b.slug !== 'string' || !b.slug.trim()) throw error(400, 'slug required');
  if (typeof b.title !== 'string' || !b.title.trim()) throw error(400, 'title required');
  const len = Number(b.length);
  if (!Number.isFinite(len) || len <= 0) throw error(400, 'length must be a positive number');
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  return {
    slug: String(b.slug).trim(),
    title: String(b.title).trim(),
    description: b.description ? String(b.description) : null,
    length: len,
    slotInterval: num(b.slotInterval),
    beforeBuffer: Number(b.beforeBuffer ?? 0),
    afterBuffer: Number(b.afterBuffer ?? 0),
    minimumBookingNotice: Number(b.minimumBookingNotice ?? 120),
    periodType: typeof b.periodType === 'string' ? b.periodType : 'rolling',
    periodDays: num(b.periodDays),
    schedulingType: b.schedulingType ? String(b.schedulingType) : null,
    useCustomSchedule: b.useCustomSchedule === true,
    scheduleRules: parseScheduleRules(b.scheduleRules),
    requiresConfirmation: b.requiresConfirmation === true,
    public: b.public !== false,
    color: b.color ? String(b.color) : null,
    productId: b.productId ? String(b.productId) : null,
    active: b.active !== false,
    resourceIds: Array.isArray(b.resourceIds) ? b.resourceIds.map(String) : [],
  };
}

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ eventTypes: await listEventTypes(ctx) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = await upsertEventType(ctx, parseEventType(b));
  return json({ id });
};
