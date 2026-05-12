import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome');
	}
	event.depends('app:org');
	const companyId = event.locals.paperclipIdentity.companyId;
	const client = paperclipServerClient(event);
	try {
		const [tree, agents] = await Promise.all([
			client.agents.org(companyId),
			client.agents.list(companyId),
		]);
		return { tree, agents };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
