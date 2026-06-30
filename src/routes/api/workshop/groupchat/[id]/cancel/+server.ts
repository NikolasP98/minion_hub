import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { cancelJobsByRef } from '$server/services/bg-runtime';
import { getGroupchatRun, setRunStatus } from '$server/services/groupchat.service';

// Stop a run: cancel its bg job(s) and mark the run cancelled.
export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.tenantCtx) throw error(401);
	const ctx = await getGroupchatRun(locals.tenantCtx.tenantId, params.id!);
	if (!ctx) throw error(404);
	await cancelJobsByRef(params.id!);
	await setRunStatus(params.id!, 'cancelled');
	return json({ ok: true });
};
