import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getTask, updateTask, deleteTask } from '$server/services/task.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const task = await getTask(ctx, params.taskId!);
  if (!task) throw error(404);
  return json({ task });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  await updateTask(ctx, params.taskId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  await deleteTask(ctx, params.taskId!);
  return json({ ok: true });
};
