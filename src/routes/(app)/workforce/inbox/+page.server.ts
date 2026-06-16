import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient, workforceRawFetch } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';

export type InboxItem = {
	id: string;
	type: 'comment' | 'approval' | 'run_failed' | 'join_request' | 'mention' | 'goal_achieved' | 'paused';
	title: string;
	body: string | null;
	actorAgentId: string | null;
	actorUserId: string | null;
	entityType: 'issue' | 'approval' | 'agent' | 'goal' | 'user' | null;
	entityId: string | null;
	href: string | null;
	createdAt: string;
	readAt: string | null;
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:inbox');
	const companyId = event.locals.workforceIdentity.companyId;
	const client = workforceServerClient(event);
	try {
		const [items, agents] = await Promise.all([
			workforceRawFetch<InboxItem[]>(event, `/api/companies/${companyId}/inbox`),
			client.agents.list(companyId),
		]);
		const agentNames: Record<string, string> = {};
		for (const a of agents) agentNames[a.id] = a.name;
		return { items, agentNames };
	} catch (e: any) {
		throw error(e?.status ?? 502, 'paperclip unavailable');
	}
};
