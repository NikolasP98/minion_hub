import type { PageServerLoad } from './$types';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { getChannelIdentitiesForUser } from '$server/services/channel-identity.service';
import { getDb } from '$server/db/client';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');

	const db = getDb();
	const tenantCtx = { db, tenantId: locals.orgId ?? 'default' };

	const agent = await getPersonalAgent(tenantCtx, locals.user.id);
	const channelIdentities = await getChannelIdentitiesForUser(tenantCtx, locals.user.id);

	return {
		agent,
		channelIdentities,
		userName: locals.user.displayName ?? locals.user.email.split('@')[0],
	};
};
