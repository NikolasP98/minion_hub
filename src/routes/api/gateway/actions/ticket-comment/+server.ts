import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { addComment, refExists } from '$server/services/activity.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	issueId: z.string().min(1).max(200),
	body: z.string().max(20_000).refine((s) => s.trim().length > 0, 'body required'),
});

/**
 * POST /api/gateway/actions/ticket-comment?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, issueId, body }
 *
 * Wraps the generic polymorphic comment path (activity.service.addComment)
 * scoped to refType='support_issue'; refExists guards the IDOR the comment
 * table's (refType, refId) design otherwise allows.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'support', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'ticket-comment', issueId: b.issueId, body: b.body.trim() } });
	}

	if (!(await refExists(ctx, 'support_issue', b.issueId))) throw error(404, 'ticket not found');
	const actor = await agentActor(principalId);
	await addComment(ctx, 'support_issue', b.issueId, b.body.trim(), actor);
	return json({ ok: true }, { status: 201 });
};
