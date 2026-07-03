import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { createTask, TASK_STATUSES } from '$server/services/projects.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	projectId: z.string().min(1).max(200),
	title: z.string().min(1).max(500),
	description: z.string().max(20_000).nullable().optional(),
	status: z.enum(TASK_STATUSES).optional(),
	priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
	assigneePartyId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/gateway/actions/task-create?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, projectId, title, description?, status?, priority?, assigneePartyId? }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'projects', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'task-create', projectId: b.projectId, title: b.title, status: b.status ?? 'backlog' } });
	}

	const actor = await agentActor(principalId);
	const task = await createTask(
		ctx,
		{
			projectId: b.projectId,
			title: b.title,
			description: b.description ?? null,
			status: b.status,
			priority: b.priority,
			assigneePartyId: b.assigneePartyId ?? null,
		},
		actor,
	);
	return json({ task }, { status: 201 });
};
