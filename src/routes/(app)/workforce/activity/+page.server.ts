import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:activity');
	const companyId = event.locals.paperclipIdentity.companyId;
	const client = paperclipServerClient(event);
	try {
		const items = await client.activity.list(companyId);
		return { items };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
