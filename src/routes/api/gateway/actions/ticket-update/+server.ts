import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { updateIssue, PRIORITIES } from '$server/services/support.service';
import { StaleWriteError } from '$server/services/errors';

const bodySchema = z.object({
	confirm: z.boolean(),
	issueId: z.string().min(1).max(200),
	subject: z.string().trim().min(1).max(500).optional(),
	description: z.string().max(20_000).nullable().optional(),
	status: z.enum(['open', 'replied', 'on_hold', 'resolved', 'closed']).optional(),
	priority: z.enum(PRIORITIES).optional(),
	ownerId: z.string().max(200).nullable().optional(),
	expectedUpdatedAt: z.coerce.date().optional(),
});

/**
 * POST /api/gateway/actions/ticket-update?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, issueId, status?, priority?, ownerId?, subject?, description?,
 *         expectedUpdatedAt? }
 *
 * expectedUpdatedAt (P0-C optimistic lock) is threaded straight through so a
 * concurrent human edit surfaces as a 409 the agent can re-read and retry.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'support', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'ticket-update',
				issueId: b.issueId,
				status: b.status,
				priority: b.priority,
				ownerId: b.ownerId,
				subject: b.subject,
			},
		});
	}

	const actor = await agentActor(principalId);
	try {
		const issue = await updateIssue(
			ctx,
			b.issueId,
			{ subject: b.subject, description: b.description, status: b.status, priority: b.priority, ownerId: b.ownerId },
			actor,
			b.expectedUpdatedAt,
		);
		if (!issue) throw error(404, 'ticket not found');
		return json({ issue });
	} catch (e) {
		if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
		throw e;
	}
};
