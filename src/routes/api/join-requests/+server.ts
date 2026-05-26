import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth, requireAdmin } from '$server/auth/authorize';
import { createRequest, listPendingRequests } from '$server/services/join/requests.service';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireAuth(locals);
	if (!user.supabaseId) throw error(400, 'supabase session required');
	const body = (await request.json().catch(() => ({}))) as { message?: string };
	const [defaultOrg] = await getDb().select({ id: organization.id }).from(organization).limit(1);
	if (!defaultOrg) throw error(500, 'no organization configured');
	const r = await createRequest(
		{ id: user.id, supabaseId: user.supabaseId, email: user.email, displayName: user.displayName },
		defaultOrg.id,
		body.message,
	);
	return json({ ok: true, id: r.id, status: r.status });
};

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	return json({ requests: await listPendingRequests() });
};
