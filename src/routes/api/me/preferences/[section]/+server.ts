import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getDb } from '$server/db/client';
import { upsertUserPreference } from '$server/services/user-preferences.service';

const VALID_SECTIONS = new Set([
	'theme',
	'crt',
	'bgPattern',
	'sparklineStyle',
	'logo',
	'locale',
]);

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const user = requireAuth(locals);
	const { section } = params;
	if (!section || !VALID_SECTIONS.has(section)) {
		throw error(400, `Invalid preference section: ${section}`);
	}
	const body = await request.json();
	const db = getDb();
	await upsertUserPreference(db, user.id, section, body.value);
	return json({ ok: true });
};
