import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { updateTask, TASK_STATUSES } from '$server/services/projects.service';
import { StaleWriteError } from '$server/services/errors';

const bodySchema = z.object({
	confirm: z.boolean(),
	taskId: z.string().min(1).max(200),
	title: z.string().min(1).max(500).optional(),
	description: z.string().max(20_000).nullable().optional(),
	status: z.enum(TASK_STATUSES).optional(),
	priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
	assigneePartyId: z.string().max(200).nullable().optional(),
	expectedUpdatedAt: z.coerce.date().optional(),
});

/**
 * POST /api/gateway/actions/task-update?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, taskId, status?, assigneePartyId?, priority?, title?, description?, expectedUpdatedAt? }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'projects', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'task-update', taskId: b.taskId, status: b.status, assigneePartyId: b.assigneePartyId } });
	}

	const actor = await agentActor(principalId);
	try {
		const task = await updateTask(
			ctx,
			b.taskId,
			{ title: b.title, description: b.description, status: b.status, priority: b.priority, assigneePartyId: b.assigneePartyId },
			actor,
			b.expectedUpdatedAt,
		);
		if (!task) throw error(404, 'task not found');
		return json({ task });
	} catch (e) {
		if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
		throw e;
	}
};
