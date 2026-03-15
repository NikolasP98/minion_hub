import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { setGroupMembers, addAgentToGroup, removeAgentFromGroup } from '$server/services/agent-group.service';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!locals.user?.id) throw error(401);
  const { agentIds } = await request.json();
  if (!Array.isArray(agentIds)) throw error(400, 'agentIds must be an array');
  await setGroupMembers(locals.tenantCtx, locals.user.id, params.groupId!, agentIds);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!locals.user?.id) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  await addAgentToGroup(locals.tenantCtx, locals.user.id, params.groupId!, agentId);
  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  if (!locals.user?.id) throw error(401);
  const { agentId } = await request.json();
  if (!agentId || typeof agentId !== 'string') throw error(400, 'agentId is required');
  await removeAgentFromGroup(locals.tenantCtx, locals.user.id, params.groupId!, agentId);
  return json({ ok: true });
};
