import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth, requireAdmin } from '$server/auth/authorize';
import { eq } from 'drizzle-orm';
import { userServers } from '$server/db/schema';
import { nowMs } from '$server/db/utils';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireAuth(locals);
	if (params.id !== user.id) requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const userId = params.id!;

	const rows = await locals.tenantCtx.db
		.select({ serverId: userServers.serverId })
		.from(userServers)
		.where(eq(userServers.userId, userId));

	return json({ serverIds: rows.map((r) => r.serverId) });
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	requireAdmin(locals);
	if (!locals.tenantCtx) throw error(401);
	const userId = params.id!;
	const db = locals.tenantCtx.db;

	const body = await request.json();
	const serverIds: string[] = body.serverIds ?? [];

	// Replace all server assignments
	await db.delete(userServers).where(eq(userServers.userId, userId));

	if (serverIds.length > 0) {
		const now = nowMs();
		await db.insert(userServers).values(
			serverIds.map((serverId) => ({ userId, serverId, createdAt: now })),
		);
	}

	return json({ ok: true });
};
