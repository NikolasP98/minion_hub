import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getProjectProgress } from '$server/services/projects.service';

/** GET /api/projects/:id/progress → { percent, done, total } */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await getProjectProgress(ctx, params.id!));
};
