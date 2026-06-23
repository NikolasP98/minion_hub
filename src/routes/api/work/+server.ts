import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listMyWork } from '$server/services/assignment.service';

// My open work queue across support / crm / sales (owner_id = me).
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx?.profileId) throw error(401);
  return json(await listMyWork(ctx, ctx.profileId));
};
