import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listPlans, createPlan } from '$server/services/membership.service';

const postSchema = z.object({
  name: z.string().min(1).max(500),
  price: z.preprocess((v) => (v == null ? null : String(v)), z.string().max(50).nullable()).optional(),
  currency: z.string().max(10).nullable().optional(),
  intervalUnit: z.enum(['day', 'week', 'month', 'year']).optional(),
  intervalCount: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listPlans(ctx));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await parseBody(request, postSchema);
  return json(await createPlan(ctx, b), { status: 201 });
};
