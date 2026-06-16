import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:projects');
	const companyId = event.locals.workforceIdentity.companyId;
	const client = workforceServerClient(event);
	try {
		const [projects, agents] = await Promise.all([
			client.projects.list(companyId),
			client.agents.list(companyId),
		]);
		const agentNames: Record<string, string> = {};
		for (const a of agents) agentNames[a.id] = a.name;
		return { projects, agentNames };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
