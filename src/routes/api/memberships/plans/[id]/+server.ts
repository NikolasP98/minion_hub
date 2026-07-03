import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { updatePlan } from '$server/services/membership.service';

const patchSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  price: z.preprocess((v) => (v == null ? null : String(v)), z.string().max(50).nullable()).optional(),
  currency: z.string().max(10).nullable().optional(),
  intervalUnit: z.enum(['day', 'week', 'month', 'year']).optional(),
  intervalCount: z.coerce.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const row = await updatePlan(ctx, params.id!, body);
  if (!row) throw error(404);
  return json(row);
};
