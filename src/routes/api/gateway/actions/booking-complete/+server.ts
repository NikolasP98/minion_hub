import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { getBooking, setBookingStatus } from '$server/services/scheduling-bookings.service';
import { listAccruals, realizeAccruals } from '$server/services/stock-accruals.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	bookingId: z.string().min(1).max(200),
	lines: z
		.array(
			z.object({
				itemId: z.string().min(1),
				qty: z.number().positive(),
				qtyConsumption: z.number().positive().nullable().optional(),
			}),
		)
		.nullable()
		.optional(),
	warehouseId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/gateway/actions/booking-complete?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, bookingId, lines?, warehouseId? }
 *
 * confirm:false — returns the booking's open accrued consumption for the agent
 * to relay (adjust via `lines` on confirm).
 * confirm:true — marks the booking completed and realizes the accrued stock
 * into a posted issue entry. A short bin never blocks completion — the
 * response carries stockWarning and the same call can be retried.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'scheduling', 'edit');
	const b = await parseBody(request, bodySchema);

	const booking = await getBooking(ctx, b.bookingId);
	if (!booking) throw error(404, 'booking not found');

	if (!b.confirm) {
		const accruals = await listAccruals(ctx, { source: 'booking', sourceId: b.bookingId, status: 'open' });
		return json({
			preview: {
				action: 'booking-complete',
				bookingId: b.bookingId,
				bookingTitle: booking.title,
				status: booking.status,
				accruals,
			},
		});
	}

	if (['cancelled', 'rejected'].includes(booking.status)) throw error(400, `booking is ${booking.status}`);
	if (booking.status !== 'completed') await setBookingStatus(ctx, b.bookingId, 'completed');
	const actor = await agentActor(principalId);
	try {
		const r = await realizeAccruals(ctx, {
			source: 'booking',
			sourceId: b.bookingId,
			lines: b.lines ?? null,
			warehouseId: b.warehouseId ?? null,
			finProductId: booking.productId ?? null,
			partyId: booking.partyId ?? null,
			note: `Booking: ${booking.title}`,
			actor,
		});
		return json({ ok: true, entryId: r.entry?.id ?? null, realized: r.realized, stockWarning: r.stockWarning });
	} catch (e) {
		return json({
			ok: true,
			entryId: null,
			realized: 0,
			stockWarning: { code: 'realize_failed', message: e instanceof Error ? e.message : 'stock realize failed' },
		});
	}
};
