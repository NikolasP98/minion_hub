import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listGroups, createGroup } from '$server/services/agent-group.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const groups = await listGroups(ctx, locals.user.supabaseId);
  return json({ groups });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { name } = await request.json();
  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  const group = await createGroup(ctx, locals.user.supabaseId, name.trim());
  return json({ group }, { status: 201 });
};
