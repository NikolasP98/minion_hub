import type { RequestHandler } from '@sveltejs/kit';
import { json, error, isHttpError } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getBrain, updateBrain, deleteBrain, resolvePrincipal } from '$server/services/brains.service';

/** GET /api/brains/:id — 404s when the brain doesn't exist OR isn't accessible
 *  (canAccessBrain fail-closed) — no existence leak on a private brain. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  let brain;
  try {
    brain = await getBrain(ctx, params.id!, principal);
  } catch (e) {
    if (isHttpError(e) && e.status === 403) throw error(404); // no access → not-found, not forbidden
    throw e;
  }
  if (!brain) throw error(404);
  return json(brain);
};

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  icon: z.string().max(80).nullable().optional(),
  visibility: z.enum(['org', 'private']).optional(),
});

/** PATCH /api/brains/:id — write-gated by canAccessBrain (creator/org-admin/access row). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  const principal = await resolvePrincipal(ctx);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const brain = await updateBrain(ctx, params.id!, body, principal, actor);
  if (!brain) throw error(404);
  return json(brain);
};

/** DELETE /api/brains/:id */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  await deleteBrain(ctx, params.id!, principal, actor);
  return json({ ok: true });
};
