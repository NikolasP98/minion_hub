import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { listServers, upsertServer } from '$server/services/server.service';
import { getTenantCtx, getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
	const ctx = await getTenantCtx(locals);
	if (!ctx) return json({ servers: [] });
	try {
		const servers = await listServers(ctx);
		return json({ servers });
	} catch (e) {
		console.error('[GET /api/servers]', e);
		return json({ servers: [] });
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const ctx = await getOrCreateTenantCtx(locals);
	try {
		const body = await request.json();
		await upsertServer(ctx, body);
		return json({ ok: true });
	} catch (e) {
		console.error('[POST /api/servers]', e);
		return json(
			{ ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};
