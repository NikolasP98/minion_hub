import { redirect, error } from '@sveltejs/kit';
import { paperclipServerClient, paperclipRawFetch } from '$lib/server/paperclip-fetch';
import type { PageServerLoad } from './$types';

type DailyCost = { date: string; cents: number };
type AgentRun = {
	id: string;
	agentId: string;
	status: 'succeeded' | 'failed' | 'running' | 'cancelled';
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	source: string;
	costCents: number;
	tokens: { input: number; output: number };
	issueId: string | null;
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.paperclipIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome');
	}
	event.depends('app:agent');
	const companyId = event.locals.paperclipIdentity.companyId;
	const agentId = event.params.id;
	const client = paperclipServerClient(event);

	try {
		const [agent, costTrend, runs, issues] = await Promise.all([
			client.agents.get(agentId, companyId),
			paperclipRawFetch<DailyCost[]>(event, `/api/agents/${agentId}/cost-trend`).catch(() => [] as DailyCost[]),
			paperclipRawFetch<AgentRun[]>(event, `/api/agents/${agentId}/runs`).catch(() => [] as AgentRun[]),
			client.issues.list(companyId, { assigneeAgentId: agentId }),
		]);
		return { agent, costTrend, runs, issues };
	} catch (e: any) {
		throw error(e?.status ?? 502, e?.status === 404 ? 'agent not found' : 'paperclip unavailable');
	}
};
