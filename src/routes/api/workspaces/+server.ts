import { json, error } from '@sveltejs/kit';
import { loadWorkspacesForUser } from '$server/services/workspaces.service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) throw error(401, 'unauthenticated');
	return json(await loadWorkspacesForUser(event.locals, user.id));
};
