import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listOrders, ORDER_STATUSES } from '$server/services/sales.service';

/**
 * GET /api/gateway/query/orders?agentId=personal-<uuid>[&orgId=][&status=][&contact=]
 *
 * Orders by status/contact. `status=open` covers non-terminal statuses (matches
 * the human sales dashboard's default).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx, capabilities, principalId } = await requireAssistantCapability(locals, url, 'sales', 'view');
	const statusParam = url.searchParams.get('status');
	const status =
		statusParam === 'open' || (ORDER_STATUSES as string[]).includes(statusParam ?? '')
			? (statusParam as 'open' | (typeof ORDER_STATUSES)[number])
			: undefined;
	const contact = url.searchParams.get('contact');
	const ownerId = capabilities.ownerScoped('sales') ? principalId : undefined;

	const orders = await listOrders(ctx, { status, crmContactId: contact ?? undefined, ownerId, limit: 200 });
	return json({ orders });
};
