import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listSkills, upsertSkills } from '$server/services/skill.service';
import { getServerCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) return json({ skills: [] });
  try {
    const skills = await listSkills(ctx);
    return json({ skills });
  } catch {
    return json({ skills: [] });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getServerCtx(locals, params.id!);
  if (!ctx) return json({ ok: false, error: 'no gateway access' }, { status: 403 });
  try {
    const body = await request.json();
    await upsertSkills(ctx, body.skills ?? []);
    return json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/skills]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
