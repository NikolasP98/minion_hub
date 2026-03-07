import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth, requireAdmin } from '$server/auth/authorize';
import { listUserAgentIds, syncUserAgents } from '$server/services/user-agents.service';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const user = requireAuth(locals);
	// Users can read their own assignments; admins can read anyone's
	if (params.id !== user.id) requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const userId = params.id!;
	const serverId = url.searchParams.get('serverId');
	if (!serverId) throw error(400, 'serverId query param required');

	const agentIds = await listUserAgentIds(locals.tenantCtx, userId, serverId);
	return json({ agentIds: [...agentIds] });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const userId = params.id!;

	const body = await request.json();
	const serverId: string = body.serverId;
	const agentIds: string[] = body.agentIds ?? [];

	if (!serverId) throw error(400, 'serverId is required');

	await syncUserAgents(locals.tenantCtx, userId, serverId, agentIds);
	return json({ ok: true });
};
