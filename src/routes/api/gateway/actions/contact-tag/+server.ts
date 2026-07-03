import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { applyTag, removeTag, listTags, createTag } from '$server/services/crm-contacts.service';

const bodySchema = z
	.object({
		confirm: z.boolean(),
		contactId: z.string().min(1).max(200),
		tagId: z.string().min(1).max(200).optional(),
		// Agent-ergonomic alternative: a tag NAME, resolved case-insensitively;
		// unknown names are created as manual tags on 'add'.
		tag: z.string().min(1).max(500).optional(),
		op: z.enum(['add', 'remove']).default('add'),
	})
	.refine((b) => b.tagId || b.tag, { message: 'tagId or tag (name) is required' });

/**
 * POST /api/gateway/actions/contact-tag?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, contactId, tagId? | tag?, op: 'add'|'remove' }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'crm', 'edit');
	const b = await parseBody(request, bodySchema);

	let tagId = b.tagId ?? null;
	let resolvedName: string | null = null;
	if (!tagId && b.tag) {
		const wanted = b.tag.trim().toLowerCase();
		const existing = (await listTags(ctx)).find((t) => t.name.trim().toLowerCase() === wanted);
		if (existing) {
			tagId = existing.id;
			resolvedName = existing.name;
		} else if (b.op === 'remove') {
			return json({ error: `no tag named "${b.tag}"` }, { status: 404 });
		}
	}

	if (!b.confirm) {
		return json({
			preview: {
				action: 'contact-tag',
				contactId: b.contactId,
				op: b.op,
				tagId,
				tag: resolvedName ?? b.tag ?? null,
				willCreateTag: !tagId && b.op === 'add' ? (b.tag ?? null) : null,
			},
		});
	}

	if (!tagId && b.tag && b.op === 'add') {
		const created = await createTag(ctx, { name: b.tag.trim(), kind: 'manual' }, principalId);
		tagId = created.id;
	}
	if (!tagId) return json({ error: 'tag could not be resolved' }, { status: 400 });

	if (b.op === 'remove') await removeTag(ctx, b.contactId, tagId);
	else await applyTag(ctx, b.contactId, tagId, principalId);
	return json({ ok: true, tagId });
};
