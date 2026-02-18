import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getMission, updateMission, deleteMission } from '$server/services/mission.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  const mission = await getMission(locals.tenantCtx, params.missionId!);
  if (!mission) throw error(404);
  return json({ mission });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);

  const body = await request.json();
  await updateMission(locals.tenantCtx, params.missionId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);

  await deleteMission(locals.tenantCtx, params.missionId!);
  return json({ ok: true });
};
