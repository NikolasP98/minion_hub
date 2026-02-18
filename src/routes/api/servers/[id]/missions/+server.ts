import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listMissions, createMission } from '$server/services/mission.service';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.tenantCtx) throw error(401);

  const sessionId = url.searchParams.get('sessionId') ?? undefined;
  const missions = await listMissions(locals.tenantCtx, {
    serverId: params.id!,
    sessionId,
  });
  return json({ missions });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  if (!body.sessionId || !body.title) throw error(400, 'sessionId and title required');

  const id = await createMission(locals.tenantCtx, {
    serverId: params.id!,
    sessionId: body.sessionId,
    title: body.title,
    description: body.description,
    metadata: body.metadata,
  });
  return json({ ok: true, id });
};
