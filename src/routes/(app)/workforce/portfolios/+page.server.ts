import { redirect } from '@sveltejs/kit';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';
import type { Portfolio } from '@minion-stack/workforce-client';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('workforce:portfolios');
	const companyId = event.locals.workforceIdentity.companyId;
	const client = workforceServerClient(event);

	// Best-effort: the page must render if the backend is down.
	let portfolios: Portfolio[] = [];
	const agentNames: Record<string, string> = {};
	try {
		const [items, agents] = await Promise.all([
			client.portfolios.list(companyId),
			client.agents.list(companyId),
		]);
		portfolios = items;
		for (const a of agents) agentNames[a.id] = a.name;
	} catch {
		portfolios = [];
	}
	return { portfolios, agentNames, companyId };
};
