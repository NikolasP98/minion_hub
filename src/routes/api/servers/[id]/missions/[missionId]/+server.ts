import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getMission, updateMission, deleteMission } from '$server/services/mission.service';
import { requireCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);

  const mission = await getMission(ctx, params.missionId!);
  if (!mission) throw error(404);
  return json({ mission });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await requireCoreCtx(locals);

  const body = await request.json();
  await updateMission(ctx, params.missionId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);

  await deleteMission(ctx, params.missionId!);
  return json({ ok: true });
};
