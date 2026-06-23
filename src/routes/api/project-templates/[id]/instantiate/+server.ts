import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { instantiateTemplate } from '$server/services/projects.service';

/** POST /api/project-templates/:id/instantiate — { name?, customerPartyId?, leadPartyId?, baseDate? } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const result = await instantiateTemplate(ctx, params.id!, body ?? {}, actor);
  if (!result) throw error(404);
  return json(result, { status: 201 });
};
