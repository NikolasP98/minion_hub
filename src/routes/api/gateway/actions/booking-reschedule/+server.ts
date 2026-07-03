import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { createBooking, setBookingStatus, SlotUnavailableError } from '$server/services/scheduling-bookings.service';

// SERVICE GAP: scheduling-bookings.service has no updateBookingTime/getBookingById —
// only create + status-set. There is no atomic "move this booking's slot" call to
// reuse, so reschedule is composed here as cancel-old + create-new (two existing,
// unmodified service calls). Because there's no getBookingById either, the caller
// must resupply the full new-slot payload (same shape as booking-create) rather
// than the route reading+diffing the old row. Report to plan owner: a real
// reschedule needs `updateBookingTime(ctx, id, newStart)` in the service layer.
const bodySchema = z.object({
	confirm: z.boolean(),
	bookingId: z.string().min(1).max(200),
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
 * POST /api/gateway/actions/booking-reschedule?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, bookingId, eventTypeId, start, attendeeName?, attendeeEmail?,
 *         attendeePhone?, notes?, crmContactId?, resourceId? }
 *
 * confirm:false → preview only (no cancel, no create). confirm:true → cancels
 * `bookingId` then creates a new booking for the new slot. See SERVICE GAP note.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'scheduling', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'booking-reschedule',
				cancels: b.bookingId,
				newStart: b.start.toISOString(),
				eventTypeId: b.eventTypeId,
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
		await setBookingStatus(ctx, b.bookingId, 'cancelled');
		return json({ booking, cancelledBookingId: b.bookingId });
	} catch (e) {
		if (e instanceof SlotUnavailableError) throw error(409, 'new slot unavailable');
		throw e;
	}
};
