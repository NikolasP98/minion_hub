import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listSkills, upsertSkills } from '$lib/../server/db';
import type { SkillRow } from '$lib/../server/db';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const skills = await listSkills(params.id!);
    return json({ skills });
  } catch {
    return json({ skills: [] });
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = (await request.json()) as { skills: SkillRow[] };
    await upsertSkills(params.id!, body.skills ?? []);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
