import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:goals');
	const companyId = event.locals.paperclipIdentity.companyId;
	const client = paperclipServerClient(event);
	try {
		const [goals, agents] = await Promise.all([
			client.goals.list(companyId),
			client.agents.list(companyId),
		]);
		const agentNames: Record<string, string> = {};
		for (const a of agents) agentNames[a.id] = a.name;
		return { goals, agentNames };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
