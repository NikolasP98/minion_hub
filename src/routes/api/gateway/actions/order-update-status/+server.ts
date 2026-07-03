import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { setOrderStatus, ORDER_STATUSES } from '$server/services/sales.service';
import { StaleWriteError } from '$server/services/errors';

const bodySchema = z.object({
	confirm: z.boolean(),
	orderId: z.string().min(1).max(200),
	status: z.enum(ORDER_STATUSES as [string, ...string[]]),
	expectedUpdatedAt: z.coerce.date().optional(),
});

/**
 * POST /api/gateway/actions/order-update-status?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, orderId, status, expectedUpdatedAt? }
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'sales', 'edit');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({ preview: { action: 'order-update-status', orderId: b.orderId, status: b.status } });
	}

	const actor = await agentActor(principalId);
	try {
		const order = await setOrderStatus(ctx, b.orderId, b.status as (typeof ORDER_STATUSES)[number], actor, b.expectedUpdatedAt);
		if (!order) throw error(404, 'order not found');
		return json({ order });
	} catch (e) {
		if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
		throw e;
	}
};
