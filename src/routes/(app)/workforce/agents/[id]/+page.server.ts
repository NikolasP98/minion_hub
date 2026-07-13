import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient, workforceRawFetch } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';
import { normalizeHarness, normalizeHarnessProposals, normalizeHarnessSignals } from '$lib/workforce/harness';

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
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:agent');
	const companyId = event.locals.workforceIdentity.companyId;
	const agentId = event.params.id;
	const client = workforceServerClient(event);

	try {
		const [agent, costTrend, runs, issues, harnessRaw, revisionsRaw, signalsRaw, proposalsRaw] = await Promise.all([
			client.agents.get(agentId, companyId),
			workforceRawFetch<DailyCost[]>(event, `/api/agents/${agentId}/cost-trend`).catch(() => [] as DailyCost[]),
			workforceRawFetch<AgentRun[]>(event, `/api/agents/${agentId}/runs`).catch(() => [] as AgentRun[]),
			client.issues.list(companyId, { assigneeAgentId: agentId }),
			workforceRawFetch<unknown>(event, `/api/agents/${agentId}/harness`).catch(() => null),
			workforceRawFetch<unknown>(event, `/api/agents/${agentId}/harness/revisions`).catch(() => []),
			workforceRawFetch<unknown>(event, `/api/agents/${agentId}/harness/signals`).catch(() => []),
			workforceRawFetch<unknown>(event, `/api/agents/${agentId}/harness/proposals`).catch(() => []),
		]);
		const revisions = Array.isArray(revisionsRaw) ? revisionsRaw : [];
		return {
			agent,
			costTrend,
			runs,
			issues,
			harness: normalizeHarness(harnessRaw, agentId),
			harnessRevisionCount: revisions.length,
			harnessSignals: normalizeHarnessSignals(signalsRaw).slice(0, 3),
			harnessProposals: normalizeHarnessProposals(proposalsRaw).slice(0, 3),
		};
	} catch (e: any) {
		throw error(e?.status ?? 502, e?.status === 404 ? 'agent not found' : 'paperclip unavailable');
	}
};
