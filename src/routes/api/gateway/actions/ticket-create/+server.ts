import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { createIssue, PRIORITIES } from '$server/services/support.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	subject: z.string().trim().min(1).max(500),
	description: z.string().max(20_000).nullable().optional(),
	priority: z.enum(PRIORITIES).optional(),
	crmContactId: z.string().max(200).nullable().optional(),
	partyId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/gateway/actions/ticket-create?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, subject, description?, priority?, crmContactId?, partyId? }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'support', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'ticket-create',
				subject: b.subject,
				description: b.description ?? null,
				priority: b.priority ?? 'medium',
			},
		});
	}

	const issue = await createIssue(ctx, {
		subject: b.subject,
		description: b.description ?? null,
		priority: b.priority,
		crmContactId: b.crmContactId ?? null,
		partyId: b.partyId ?? null,
		source: 'agent',
	});
	return json({ issue }, { status: 201 });
};
