import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listSkills, upsertSkills } from '$server/services/skill.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const skills = await listSkills(ctx, params.id!);
    return json({ skills });
  } catch {
    return json({ skills: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = requireTenantCtx(locals);
  try {
    const body = await request.json();
    await upsertSkills(ctx, params.id!, body.skills ?? []);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/skills]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
