import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { updatePlan } from '$server/services/membership.service';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const row = await updatePlan(ctx, params.id!, await request.json());
  if (!row) throw error(404);
  return json(row);
};
