import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$server/db/client';
import { invitation, organization } from '$server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Public endpoint — no auth required.
 * The invitation ID is a random CUID; knowing it is equivalent to having the invite link.
 */
export const GET: RequestHandler = async ({ params }) => {
	const db = getDb();
	const rows = await db
		.select({
			email: invitation.email,
			role: invitation.role,
			status: invitation.status,
			expiresAt: invitation.expiresAt,
			organizationName: organization.name,
		})
		.from(invitation)
		.innerJoin(organization, eq(invitation.organizationId, organization.id))
		.where(eq(invitation.id, params.id))
		.limit(1);

	if (rows.length === 0) {
		return json({ error: 'Invitation not found' }, { status: 404 });
	}

	const row = rows[0];
	return json({
		email: row.email,
		role: row.role,
		status: row.status,
		organizationName: row.organizationName,
		expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
	});
};
