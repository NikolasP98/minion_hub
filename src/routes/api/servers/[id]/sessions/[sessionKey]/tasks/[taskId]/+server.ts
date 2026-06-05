import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateSessionTask, deleteSessionTask } from '$server/services/session-task.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const taskId = params.taskId!;
  const body = await request.json();

  const data: Record<string, unknown> = {};
  if (typeof body.title === 'string') data.title = body.title;
  if (typeof body.description === 'string') data.description = body.description;
  if (typeof body.status === 'string') data.status = body.status;
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder;

  await updateSessionTask(ctx, taskId, data);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const taskId = params.taskId!;
  await deleteSessionTask(ctx, taskId);
  return json({ ok: true });
};
