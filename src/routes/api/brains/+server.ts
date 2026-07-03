import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listBrains, createBrain, resolvePrincipal } from '$server/services/brains.service';

/** GET /api/brains — brains visible to the caller (org-visible + private w/ access). */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  return json({ brains: await listBrains(ctx, principal) });
};

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  icon: z.string().max(80).nullable().optional(),
  visibility: z.enum(['org', 'private']).optional(),
});

/** POST /api/brains — create a brain. Write-gated centrally (brains:edit) by hooks.server.ts. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const brain = await createBrain(ctx, body, actor);
  return json(brain, { status: 201 });
};
