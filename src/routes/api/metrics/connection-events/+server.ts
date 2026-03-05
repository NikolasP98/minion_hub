import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listConnectionEvents } from '$server/services/connection.service';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.tenantCtx) throw error(401);

	const serverId = url.searchParams.get('serverId') ?? undefined;
	if (!serverId) return json({ events: [] });

	const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;
	const events = await listConnectionEvents(locals.tenantCtx, serverId, limit);

	return json({ events });
};
