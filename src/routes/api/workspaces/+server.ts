import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workspaceMembership } from '$server/db/schema/workspace-membership';
import { eq } from 'drizzle-orm';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) throw error(401, 'unauthenticated');

	const db = getDb();
	const memberships = await db
		.select()
		.from(workspaceMembership)
		.where(eq(workspaceMembership.userId, user.id));

	// Hydrate display name per company from paperclip. Graceful on outage.
	const client = paperclipServerClient(event);
	const companies: Array<{ id: string; name: string }> = await client.companies
		.list()
		.catch(() => []);
	const byId = new Map(companies.map((c) => [c.id, c]));

	return json(
		memberships.map((m) => ({
			companyId: m.paperclipCompanyId,
			role: m.role,
			name: byId.get(m.paperclipCompanyId)?.name ?? m.paperclipCompanyId,
		})),
	);
};
