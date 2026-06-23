import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { addComment } from '$server/services/activity.service';

/** POST /api/activity/comments — { refType, refId, body }. Generic across modules. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { refType, refId, body } = await request.json();
  if (!refType || !refId || !body?.trim()) throw error(400, 'refType, refId, body required');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  await addComment(ctx, String(refType), String(refId), String(body).trim(), actor);
  return json({ ok: true }, { status: 201 });
};
