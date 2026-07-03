import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { instantiateTemplate } from '$server/services/projects.service';

const postSchema = z.object({
  name: z.string().max(500).optional(),
  customerPartyId: z.string().max(200).nullable().optional(),
  leadPartyId: z.string().max(200).nullable().optional(),
  baseDate: z.string().max(60).nullable().optional(),
});

/** POST /api/project-templates/:id/instantiate — { name?, customerPartyId?, leadPartyId?, baseDate? } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const result = await instantiateTemplate(ctx, params.id!, body, actor);
  if (!result) throw error(404);
  return json(result, { status: 201 });
};
