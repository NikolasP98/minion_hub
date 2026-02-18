import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTask, updateTask, deleteTask } from '$server/services/task.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const task = await getTask(locals.tenantCtx, params.taskId!);
  if (!task) throw error(404);
  return json({ task });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  await updateTask(locals.tenantCtx, params.taskId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  await deleteTask(locals.tenantCtx, params.taskId!);
  return json({ ok: true });
};
