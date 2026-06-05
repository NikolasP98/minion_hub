import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { updateGroup, deleteGroup } from '$server/services/agent-group.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const body = await request.json();
  await updateGroup(ctx, locals.user.supabaseId, params.groupId!, body);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  await deleteGroup(ctx, locals.user.supabaseId, params.groupId!);
  return json({ ok: true });
};
