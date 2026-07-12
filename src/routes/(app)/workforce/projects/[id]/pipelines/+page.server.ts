import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getProject, workforceProjectIdOf } from '$server/services/projects.service';
import { workforceServerClient } from '$lib/server/workforce-fetch';

// RBAC: /workforce/* is centrally gated to projects:view by requiredViewPermForPath
// (ROUTE_VIEW_PERMS prefix match in $lib/permissions.ts); writes go through the
// /api/workforce proxy, gated by API_WRITE_PREFIXES in rbac.service.ts.
export const load: PageServerLoad = async (event) => {
	const { locals, params, depends } = event;
	const ctx = await getCoreCtx(locals);
	if (!ctx) throw error(401, 'Authentication required');
	depends('workforce:pipelines');

	// [id] is the NATIVE hub project id (same as the parent detail page).
	const project = await getProject(ctx, params.id);
	if (!project) throw error(404, 'Project not found');

	const companyId = locals.workforceIdentity?.companyId;
	if (!companyId) throw redirect(302, '/workforce/welcome?reason=no-company');

	const workforceProjectId = workforceProjectIdOf(project);
	// Pipelines live on the LINKED workforce project — nothing to edit if unlinked.
	if (!workforceProjectId) throw redirect(302, `/workforce/projects/${params.id}`);

	const client = workforceServerClient(event);
	try {
		const [pipelines, agents] = await Promise.all([
			client.pipelines.list(companyId, { projectId: workforceProjectId }),
			client.agents.list(companyId),
		]);
		return {
			project: { id: project.id, name: project.name },
			companyId,
			workforceProjectId,
			pipelines,
			agents: agents.map((a) => ({ id: a.id, name: a.name })),
		};
	} catch (e) {
		const status = (e as { status?: number })?.status;
		throw error(status ?? 502, 'workforce unavailable');
	}
};
