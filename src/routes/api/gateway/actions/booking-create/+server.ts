import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { createBooking, SlotUnavailableError } from '$server/services/scheduling-bookings.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	eventTypeId: z.string().min(1).max(200),
	start: z.coerce.date(),
	attendeeName: z.string().max(500).nullable().optional(),
	attendeeEmail: z.string().max(500).nullable().optional(),
	attendeePhone: z.string().max(500).nullable().optional(),
	notes: z.string().max(20_000).nullable().optional(),
	crmContactId: z.string().max(200).nullable().optional(),
	resourceId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/gateway/actions/booking-create?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, eventTypeId, start, attendeeName?, attendeeEmail?, attendeePhone?,
 *         notes?, crmContactId?, resourceId? }
 *
 * confirm:false → validated preview, no write. confirm:true → creates the
 * booking via the same service the human internal-booking UI uses (bypasses
 * min-notice, still respects conflicts).
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'scheduling', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'booking-create',
				eventTypeId: b.eventTypeId,
				start: b.start.toISOString(),
				attendeeName: b.attendeeName ?? null,
				attendeeEmail: b.attendeeEmail ?? null,
				attendeePhone: b.attendeePhone ?? null,
				notes: b.notes ?? null,
			},
		});
	}

	try {
		const booking = await createBooking(ctx, {
			eventTypeId: b.eventTypeId,
			start: b.start,
			attendeeName: b.attendeeName ?? null,
			attendeeEmail: b.attendeeEmail ?? null,
			attendeePhone: b.attendeePhone ?? null,
			notes: b.notes ?? null,
			crmContactId: b.crmContactId ?? null,
			preferredResourceId: b.resourceId ?? null,
			source: 'internal',
			bypassRules: true,
		});
		return json({ booking });
	} catch (e) {
		if (e instanceof SlotUnavailableError) throw error(409, 'slot unavailable');
		throw e;
	}
};
