import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { setBookingStatus } from '$server/services/scheduling-bookings.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	bookingId: z.string().min(1).max(200),
});

/**
 * POST /api/gateway/actions/booking-cancel?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, bookingId }
 *
 * Mirrors PATCH /api/scheduling/bookings/:id { status: 'cancelled' } (the
 * human cancel path) via the same `setBookingStatus` service call.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'scheduling', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'booking-cancel', bookingId: b.bookingId, newStatus: 'cancelled' } });
	}

	try {
		await setBookingStatus(ctx, b.bookingId, 'cancelled');
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'invalid');
	}
	return json({ ok: true });
};
