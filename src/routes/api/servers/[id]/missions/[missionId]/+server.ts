import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getMission, updateMission, deleteMission } from '$server/services/mission.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);

  const mission = await getMission(ctx, params.missionId!);
  if (!mission) throw error(404);
  return json({ mission });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = requireTenantCtx(locals);

  const body = await request.json();
  await updateMission(ctx, params.missionId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);

  await deleteMission(ctx, params.missionId!);
  return json({ ok: true });
};
