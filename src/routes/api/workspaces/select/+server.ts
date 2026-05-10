import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workspaceMembership } from '$server/db/schema/workspace-membership';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const user = locals.user;
	if (!user) throw error(401, 'unauthenticated');

	const { companyId } = (await request.json()) as { companyId?: string };
	if (!companyId) throw error(400, 'companyId required');

	const db = getDb();
	const [row] = await db
		.select()
		.from(workspaceMembership)
		.where(
			and(
				eq(workspaceMembership.userId, user.id),
				eq(workspaceMembership.paperclipCompanyId, companyId),
			),
		)
		.limit(1);

	if (!row) throw error(403, 'not a member');

	cookies.set('pc_company_id', companyId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		maxAge: 60 * 60 * 24 * 365,
	});

	return json({ ok: true, companyId });
};
