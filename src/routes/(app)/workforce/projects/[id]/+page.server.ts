import { redirect, error } from '@sveltejs/kit';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) throw redirect(302, '/login');
	if (!event.locals.workforceIdentity?.companyId) {
		throw redirect(302, '/workforce/welcome?reason=no-company');
	}
	event.depends('app:project');
	const companyId = event.locals.workforceIdentity.companyId;
	const projectId = event.params.id;
	const client = workforceServerClient(event);

	try {
		const [project, issues, agents] = await Promise.all([
			client.projects.get(projectId, companyId),
			client.issues.list(companyId, { projectId }),
			client.agents.list(companyId),
		]);
		const agentNames: Record<string, string> = {};
		for (const a of agents) agentNames[a.id] = a.name;
		return { project, issues, agentNames };
	} catch (e: any) {
		throw error(e?.status ?? 502, e?.status === 404 ? 'project not found' : 'paperclip unavailable');
	}
};
