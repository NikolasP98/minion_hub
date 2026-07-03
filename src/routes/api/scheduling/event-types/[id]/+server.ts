import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getEventType, upsertEventType, deleteEventType, parseScheduleRules } from '$server/services/scheduling.service';
import type { EventTypeInput } from '$server/services/scheduling.service';

// null/''/undefined -> null (unset), else coerce to number. Mirrors the old num() helper.
const numOrNull = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().nullable());

const eventTypeSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  length: z.coerce.number().positive(),
  slotInterval: numOrNull.optional(),
  beforeBuffer: z.coerce.number().optional(),
  afterBuffer: z.coerce.number().optional(),
  minimumBookingNotice: z.coerce.number().optional(),
  periodType: z.string().max(50).optional(),
  periodDays: numOrNull.optional(),
  schedulingType: z.string().max(50).nullable().optional(),
  useCustomSchedule: z.boolean().optional(),
  scheduleRules: z.unknown().optional(),
  requiresConfirmation: z.boolean().optional(),
  public: z.boolean().optional(),
  color: z.string().max(50).nullable().optional(),
  productId: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  resourceIds: z.array(z.string().max(200)).optional(),
});

function toEventTypeInput(b: z.infer<typeof eventTypeSchema>): EventTypeInput {
  return {
    slug: b.slug.trim(),
    title: b.title.trim(),
    description: b.description ?? null,
    length: b.length,
    slotInterval: b.slotInterval ?? null,
    beforeBuffer: b.beforeBuffer ?? 0,
    afterBuffer: b.afterBuffer ?? 0,
    minimumBookingNotice: b.minimumBookingNotice ?? 120,
    periodType: b.periodType ?? 'rolling',
    periodDays: b.periodDays ?? null,
    schedulingType: b.schedulingType ?? null,
    useCustomSchedule: b.useCustomSchedule === true,
    scheduleRules: parseScheduleRules(b.scheduleRules),
    requiresConfirmation: b.requiresConfirmation === true,
    public: b.public !== false,
    color: b.color ?? null,
    productId: b.productId ?? null,
    active: b.active !== false,
    resourceIds: b.resourceIds ?? [],
  };
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const et = await getEventType(ctx, params.id!);
  if (!et) throw error(404);
  return json({ eventType: et });
};

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, eventTypeSchema);
  await upsertEventType(ctx, toEventTypeInput(b), params.id!);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  await deleteEventType(ctx, params.id!);
  return json({ ok: true });
};
