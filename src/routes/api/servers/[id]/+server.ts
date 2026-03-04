import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$server/services/server.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { userServers } from '$server/db/schema';
import { and, eq } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const ctx = await getOrCreateTenantCtx(locals);
	try {
		const id = params.id!;
		const user = locals.user;
		if (user && user.email !== 'admin@minion.hub') {
			const [link] = await ctx.db
				.select({ serverId: userServers.serverId })
				.from(userServers)
				.where(and(eq(userServers.userId, user.id), eq(userServers.serverId, id)));
			if (!link) return json({ ok: false, error: 'Not found' }, { status: 404 });
		}
		const body = await request.json();
		await upsertServer(ctx, { id, name: '', url: '', token: '', ...body }, locals.user?.id);
		return json({ ok: true });
	} catch (e) {
		console.error(`[PUT /api/servers/${params.id}]`, e);
		return json(
			{ ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const ctx = await getOrCreateTenantCtx(locals);
	try {
		const id = params.id!;
		const user = locals.user;
		if (user && user.email !== 'admin@minion.hub') {
			const [link] = await ctx.db
				.select({ serverId: userServers.serverId })
				.from(userServers)
				.where(and(eq(userServers.userId, user.id), eq(userServers.serverId, id)));
			if (!link) return json({ ok: false, error: 'Not found' }, { status: 404 });
		}
		await deleteServer(ctx, id);
		return json({ ok: true });
	} catch (e) {
		console.error(`[DELETE /api/servers/${params.id}]`, e);
		return json(
			{ ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};
