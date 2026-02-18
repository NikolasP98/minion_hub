import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listTasks, createTask } from '$server/services/task.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const tasks = await listTasks(locals.tenantCtx, params.missionId!);
  return json({ tasks });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  if (!body.title) throw error(400, 'title required');

  const id = await createTask(locals.tenantCtx, {
    missionId: params.missionId!,
    title: body.title,
    description: body.description,
    status: body.status,
    sortOrder: body.sortOrder,
    metadata: body.metadata,
  });
  return json({ ok: true, id });
};
