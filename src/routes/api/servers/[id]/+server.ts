import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { upsertServer, deleteServer } from '$server/services/server.service';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const ctx = await getOrCreateTenantCtx(locals);
	try {
		const body = await request.json();
		const id = params.id!;
		await upsertServer(ctx, { id, name: '', url: '', token: '', ...body });
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
		await deleteServer(ctx, params.id!);
		return json({ ok: true });
	} catch (e) {
		console.error(`[DELETE /api/servers/${params.id}]`, e);
		return json(
			{ ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
			{ status: 500 },
		);
	}
};
