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
  } catch {
    return json({ ok: true });
  }
};
