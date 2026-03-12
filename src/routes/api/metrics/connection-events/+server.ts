import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listEvents, eventsSummary } from '$server/services/events.service';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.tenantCtx) throw error(401);

	const serverId = url.searchParams.get('serverId') ?? undefined;
	if (!serverId) return json({ events: [], summary: null });

	const category = url.searchParams.get('category') ?? undefined;
	const severity = url.searchParams.get('severity') ?? undefined;
	const agentId = url.searchParams.get('agentId') ?? undefined;
	const since = url.searchParams.get('since') ? Number(url.searchParams.get('since')) : undefined;
	const until = url.searchParams.get('until') ? Number(url.searchParams.get('until')) : undefined;
	const limit = url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : 100;
	const offset = url.searchParams.get('offset') ? Number(url.searchParams.get('offset')) : undefined;

	const includeSummary = url.searchParams.get('summary') === '1';

	const events = await listEvents(locals.tenantCtx, serverId, {
		category,
		severity,
		agentId,
		since,
		until,
		limit,
		offset,
	});

	const summary = includeSummary ? await eventsSummary(locals.tenantCtx, serverId, { since }) : null;

	return json({ events, summary });
};
