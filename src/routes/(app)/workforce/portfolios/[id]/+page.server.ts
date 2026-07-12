import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';
import type { Portfolio, PortfolioMetrics, Project } from '@minion-stack/workforce-client';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('workforce:portfolio');
	const companyId = event.locals.workforceIdentity.companyId;
	const client = workforceServerClient(event);

	let portfolio: Portfolio;
	try {
		portfolio = await client.portfolios.get(event.params.id, companyId);
	} catch (e) {
		throw error((e as { status?: number })?.status ?? 502, 'workforce unavailable');
	}

	// Best-effort sidecars — the charter must render even if these fail.
	const [projects, metrics, agents] = await Promise.all([
		client.portfolios.projects(event.params.id, companyId).catch(() => [] as Project[]),
		client.portfolios.metrics(event.params.id, companyId).catch(() => null as PortfolioMetrics | null),
		client.agents.list(companyId).catch(() => []),
	]);
	const agentNames: Record<string, string> = {};
	for (const a of agents) agentNames[a.id] = a.name;

	return { portfolio, projects, metrics, agentNames };
};
