import { redirect, error } from '@sveltejs/kit';
import { paperclipRawFetch } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

export type CostKpis = {
	todayCents: number;
	last7Cents: number;
	monthCents: number;
	projectedMonthEndCents: number;
	budgetCents: number;
};

export type CostByAgent = {
	agentId: string;
	agentName: string;
	role: string;
	status: string;
	cents: number;
	tokens: { input: number; output: number };
};

export type CostByProvider = {
	provider: string;
	model: string;
	cents: number;
	share: number;
	requests: number;
};

type DailyCost = { date: string; cents: number };

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome');
	}
	event.depends('app:costs');
	const companyId = event.locals.paperclipIdentity.companyId;

	try {
		const [kpis, byAgent, byProvider, trend] = await Promise.all([
			paperclipRawFetch<CostKpis>(event, `/api/companies/${companyId}/costs/kpis`),
			paperclipRawFetch<CostByAgent[]>(event, `/api/companies/${companyId}/costs/by-agent`),
			paperclipRawFetch<CostByProvider[]>(event, `/api/companies/${companyId}/costs/by-provider`),
			paperclipRawFetch<DailyCost[]>(event, `/api/companies/${companyId}/costs/trend`),
		]);
		return { kpis, byAgent, byProvider, trend };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
