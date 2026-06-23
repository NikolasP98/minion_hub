import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getProjectGantt } from '$server/services/projects.service';

/** GET /api/projects/:id/gantt → task rows with timeline dates. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await getProjectGantt(ctx, params.id!));
};
