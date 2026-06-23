import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listTasks, createTask, TASK_STATUSES, type TaskStatus } from '$server/services/projects.service';

/** GET /api/projects/:id/tasks?status=&assignee=&milestones= */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(
    await listTasks(ctx, {
      projectId: params.id!,
      status: (url.searchParams.get('status') as TaskStatus) ?? undefined,
      assigneePartyId: url.searchParams.get('assignee') ?? undefined,
      includeMilestones: url.searchParams.get('milestones') === '1',
    }),
  );
};

/** POST /api/projects/:id/tasks — { title, ... } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  if (!body?.title || typeof body.title !== 'string') throw error(400, 'title required');
  if (body.status && !TASK_STATUSES.includes(body.status)) throw error(400, 'invalid status');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null, email: locals.user?.email ?? null };
  const task = await createTask(ctx, { ...body, projectId: params.id! }, actor);
  return json(task, { status: 201 });
};
