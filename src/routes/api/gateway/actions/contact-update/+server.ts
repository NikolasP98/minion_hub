import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { getContact, updateContact, setFunnelStage, addNote } from '$server/services/crm-contacts.service';
import { StaleWriteError } from '$server/services/errors';

const bodySchema = z
	.object({
		confirm: z.boolean(),
		contactId: z.string().min(1).max(200),
		name: z.string().max(500).nullable().optional(),
		phone: z.string().max(50).nullable().optional(),
		email: z.string().max(320).nullable().optional(),
		funnelStage: z.string().max(200).optional(),
		notes: z.string().max(20_000).optional(),
		expectedUpdatedAt: z.coerce.date().optional(),
	})
	.refine(
		(b) => b.name !== undefined || b.phone !== undefined || b.email !== undefined || b.funnelStage || b.notes,
		'at least one of name/phone/email/funnelStage/notes is required',
	);

/**
 * POST /api/gateway/actions/contact-update?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, contactId, name?, phone?, email?, funnelStage?, notes?, expectedUpdatedAt? }
 *
 * Whitelisted fields per the plan (name/phone/email/funnel stage/notes). email
 * and funnel stage have no dedicated columns on crm_contacts — email lives in
 * custom_fields (merged in here, not a blind overwrite, since updateContact's
 * customFields param REPLACES the whole object) and funnel stage goes through
 * the dedicated setFunnelStage (advance-only unless by:'user'; an agent write
 * is by:'agent', matching the service's own semantics for automated callers).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'crm', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'contact-update',
				contactId: b.contactId,
				name: b.name,
				phone: b.phone,
				email: b.email,
				funnelStage: b.funnelStage,
				notes: b.notes,
			},
		});
	}

	let updatedContact: unknown = null;
	if (b.name !== undefined || b.phone !== undefined || b.email !== undefined) {
		let customFields: Record<string, unknown> | undefined;
		if (b.email !== undefined) {
			const current = await getContact(ctx, b.contactId);
			if (!current) throw error(404, 'contact not found');
			customFields = { ...(current.contact.customFields as Record<string, unknown>), email: b.email };
		}
		try {
			updatedContact = await updateContact(
				ctx,
				b.contactId,
				{ displayName: b.name, phone: b.phone, customFields },
				b.expectedUpdatedAt,
			);
		} catch (e) {
			if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
			throw e;
		}
		if (!updatedContact) throw error(404, 'contact not found');
	}

	let funnel: { applied: boolean; stage: string } | null = null;
	if (b.funnelStage) {
		funnel = await setFunnelStage(ctx, b.contactId, b.funnelStage, { by: 'agent', reason: 'set by agent' });
	}

	if (b.notes) {
		await addNote(ctx, b.contactId, b.notes, ctx.profileId ?? null);
	}

	return json({ contact: updatedContact, funnel });
};
