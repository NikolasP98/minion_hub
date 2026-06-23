import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { updateTask, TASK_STATUSES } from '$server/services/projects.service';

/** PATCH /api/project-tasks/:id — update status/assignee/priority/etc. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  if (body?.status && !TASK_STATUSES.includes(body.status)) throw error(400, 'invalid status');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const task = await updateTask(ctx, params.id!, body, actor);
  if (!task) throw error(404);
  return json(task);
};
