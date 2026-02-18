import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listSessions, upsertSession } from '$server/services/session.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const sessions = await listSessions(locals.tenantCtx, params.id!);
  return json({ sessions });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  const id = await upsertSession(locals.tenantCtx, { ...body, serverId: params.id! });
  return json({ ok: true, id });
};
