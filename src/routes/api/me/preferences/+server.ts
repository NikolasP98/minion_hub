import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getDb } from '$server/db/client';
import { getUserPreferences } from '$server/services/user-preferences.service';

export const GET: RequestHandler = async ({ locals }) => {
	const user = requireAuth(locals);
	const db = getDb();
	const preferences = await getUserPreferences(db, user.id);
	return json({ preferences });
};
