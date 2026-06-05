import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  setGroupMembers,
  addAgentToGroup,
  removeAgentFromGroup,
} from '$server/services/agent-group.service';
import { getCoreCtx } from '$server/auth/core-ctx';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentIds } = await request.json();
  if (!Array.isArray(agentIds)) throw error(400, 'agentIds must be an array');
  await setGroupMembers(ctx, locals.user.supabaseId, params.groupId!, agentIds);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  await addAgentToGroup(ctx, locals.user.supabaseId, params.groupId!, agentId);
  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!locals.user?.supabaseId) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  await removeAgentFromGroup(ctx, locals.user.supabaseId, params.groupId!, agentId);
  return json({ ok: true });
};
