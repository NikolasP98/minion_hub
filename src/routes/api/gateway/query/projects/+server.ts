import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listProjects, listTasks, TASK_STATUSES, type TaskStatus, type ProjectStatus, PROJECT_STATUSES } from '$server/services/projects.service';

/**
 * GET /api/gateway/query/projects?agentId=personal-<uuid>[&orgId=][&projectId=][&status=][&assignee=]
 *
 * Projects (optionally filtered by status) + their tasks (optionally filtered
 * by projectId/status/assignee party). Two list calls, same shape the
 * /projects dashboard and /projects/:id/tasks route already expose.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'projects', 'view');
	const projectId = url.searchParams.get('projectId');
	const statusParam = url.searchParams.get('status');
	const assignee = url.searchParams.get('assignee');

	const projectStatus = (PROJECT_STATUSES as string[]).includes(statusParam ?? '')
		? (statusParam as ProjectStatus)
		: undefined;
	const taskStatus = (TASK_STATUSES as string[]).includes(statusParam ?? '') ? (statusParam as TaskStatus) : undefined;

	const [projects, tasks] = await Promise.all([
		listProjects(ctx, { status: projectStatus, limit: 200 }),
		listTasks(ctx, { projectId: projectId ?? undefined, status: taskStatus, assigneePartyId: assignee ?? undefined }),
	]);
	return json({ projects, tasks });
};
