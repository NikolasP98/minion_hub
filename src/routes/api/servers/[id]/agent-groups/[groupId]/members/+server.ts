import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  setGroupMembers,
  addAgentToGroup,
  removeAgentFromGroup,
  userOwnsGroup,
} from '$server/services/agent-group.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentIds } = await request.json();
  if (!Array.isArray(agentIds)) throw error(400, 'agentIds must be an array');
  if (!(await userOwnsGroup(ctx, locals.user.supabaseId, params.groupId!))) throw error(404);
  await setGroupMembers(ctx, locals.user.supabaseId, params.groupId!, agentIds);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  // Groups are personal (profile-owned); RLS only scopes by org.
  if (!(await userOwnsGroup(ctx, locals.user.supabaseId, params.groupId!))) throw error(404);
  await addAgentToGroup(ctx, locals.user.supabaseId, params.groupId!, agentId);
  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  // Groups are personal (profile-owned); RLS only scopes by org.
  if (!(await userOwnsGroup(ctx, locals.user.supabaseId, params.groupId!))) throw error(404);
  await removeAgentFromGroup(ctx, locals.user.supabaseId, params.groupId!, agentId);
  return json({ ok: true });
};
