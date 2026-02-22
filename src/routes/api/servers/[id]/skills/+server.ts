import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listSkills, upsertSkills } from '$server/services/skill.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const skills = await listSkills(locals.tenantCtx, params.id!);
    return json({ skills });
  } catch {
    return json({ skills: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    await upsertSkills(locals.tenantCtx, params.id!, body.skills ?? []);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/skills]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
