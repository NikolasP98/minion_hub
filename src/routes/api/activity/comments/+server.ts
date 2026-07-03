import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { addComment, refExists } from '$server/services/activity.service';

const postSchema = z.object({
  refType: z.string().min(1).max(200),
  refId: z.string().min(1).max(200),
  body: z.string().max(20_000).refine((s) => s.trim().length > 0, 'body required'),
});

/** POST /api/activity/comments — { refType, refId, body }. Generic across modules.
 *  Authorization: refType must be allowlisted and the target row must exist in
 *  the caller's org (refExists) — otherwise the polymorphic write is an IDOR. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { refType, refId, body } = await parseBody(request, postSchema);
  if (!(await refExists(ctx, refType, refId))) throw error(404, 'unknown or inaccessible record');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  await addComment(ctx, refType, refId, body.trim(), actor);
  return json({ ok: true }, { status: 201 });
};
