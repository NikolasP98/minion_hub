import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listSessionTasks, createSessionTask } from '$server/services/session-task.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const serverId = params.id!;
  const sessionKey = decodeURIComponent(params.sessionKey!);

  const tasks = await listSessionTasks(ctx, serverId, sessionKey);
  return json({ tasks });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);

  const serverId = params.id!;
  const sessionKey = decodeURIComponent(params.sessionKey!);
  const body = await request.json();

  if (!body.title || typeof body.title !== 'string') {
    throw error(400, 'title is required');
  }

  const id = await createSessionTask(ctx, {
    serverId,
    sessionKey,
    title: body.title,
    description: typeof body.description === 'string' ? body.description : undefined,
    status: body.status,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
  });

  return json({ ok: true, id });
};
