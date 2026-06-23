import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getProject, updateProject, PROJECT_STATUSES } from '$server/services/projects.service';

/** GET /api/projects/:id */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const project = await getProject(ctx, params.id!);
  if (!project) throw error(404);
  return json(project);
};

/** PATCH /api/projects/:id */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  if (body?.status && !PROJECT_STATUSES.includes(body.status)) throw error(400, 'invalid status');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const project = await updateProject(ctx, params.id!, body, actor);
  if (!project) throw error(404);
  return json(project);
};
