import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome');
	}
	event.depends('app:issues');
	const companyId = event.locals.paperclipIdentity.companyId;
	const status = event.url.searchParams.get('status') ?? undefined;
	const client = paperclipServerClient(event);
	try {
		const items = await client.issues.list(companyId, status ? { status } : undefined);
		return { items, status: status ?? null };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
