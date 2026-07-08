import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { computeTicketTotals, getOpenShift, submitTicket, PosError } from '$server/services/pos.service';

const lineSchema = z.object({
	kind: z.enum(['service', 'product']),
	finProductId: z.string().min(1).nullable().optional(),
	description: z.string().min(1).max(500),
	qty: z.number().finite(),
	unitPrice: z.number().finite(),
	discount: z.number().finite().optional(),
});

const paymentSchema = z.object({
	method: z.string().min(1).max(40),
	amount: z.number().finite(),
	tendered: z.number().finite().nullable().optional(),
});

const bodySchema = z.object({
	lines: z.array(lineSchema).min(1),
	payments: z.array(paymentSchema).min(1),
	customerName: z.string().max(500).nullable().optional(),
	partyId: z.string().max(200).nullable().optional(),
	note: z.string().max(20_000).nullable().optional(),
	discount: z.number().finite().optional(),
	confirm: z.boolean().optional(),
});

/**
 * POST /api/gateway/actions/pos-sale?agentId=personal-<uuid>[&orgId=]
 * body: { lines, payments, customerName?, partyId?, note?, discount?, confirm? }
 *
 * confirm:false/omitted — pure preview (no writes): computed line/subtotal/
 * total via the same computeTicketTotals math submitTicket persists, plus
 * whether a shift is open to ring the sale against.
 * confirm:true — rings up the sale via submitTicket. Business-rule rejections
 * (no open shift, payment mismatch, unknown method, ...) degrade to
 * `{ok:false, error, code}` rather than a raw 500 so the agent can relay the
 * reason; anything else rethrows.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'pos', 'edit');
	const b = await parseBody(request, bodySchema);

	if (b.confirm !== true) {
		const { lineTotals, subtotal, discount, total } = computeTicketTotals(b.lines, b.discount);
		const openShift = (await getOpenShift(ctx)) !== null;
		return json({
			preview: {
				total,
				subtotal,
				discount,
				lines: b.lines.map((l, i) => ({ ...l, total: lineTotals[i] })),
				openShift,
			},
		});
	}

	const actor = await agentActor(principalId);
	try {
		const { ticket, stockWarning } = await submitTicket(ctx, {
			lines: b.lines,
			payments: b.payments,
			partyId: b.partyId ?? null,
			customerName: b.customerName ?? null,
			discount: b.discount,
			note: b.note ?? null,
			actor,
		});
		return json({ ok: true, ticketId: ticket.id, humanId: ticket.humanId, stockWarning });
	} catch (e) {
		if (e instanceof PosError) return json({ ok: false, error: e.message, code: e.code });
		throw e;
	}
};
