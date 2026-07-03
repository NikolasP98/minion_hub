import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { applyTag, removeTag } from '$server/services/crm-contacts.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	contactId: z.string().min(1).max(200),
	tagId: z.string().min(1).max(200),
	op: z.enum(['add', 'remove']).default('add'),
});

/**
 * POST /api/gateway/actions/contact-tag?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, contactId, tagId, op: 'add'|'remove' }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'crm', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'contact-tag', contactId: b.contactId, tagId: b.tagId, op: b.op } });
	}

	if (b.op === 'remove') await removeTag(ctx, b.contactId, b.tagId);
	else await applyTag(ctx, b.contactId, b.tagId, principalId);
	return json({ ok: true });
};
