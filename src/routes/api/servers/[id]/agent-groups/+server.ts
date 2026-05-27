import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listGroups, createGroup } from '$server/services/agent-group.service';
import { requireTenantCtx } from '$server/auth/authorize';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = requireTenantCtx(locals);
  if (!locals.user?.id) throw error(401);
  const groups = await listGroups(ctx, locals.user.id);
  return json({ groups });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = requireTenantCtx(locals);
  if (!locals.user?.id) throw error(401);
  const { name } = await request.json();
  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  const group = await createGroup(ctx, locals.user.id, name.trim());
  return json({ group }, { status: 201 });
};
