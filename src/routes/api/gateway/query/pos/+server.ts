import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { listSellables, getOpenShift, listTickets } from '$server/services/pos.service';

/**
 * GET /api/gateway/query/pos?agentId=personal-<uuid>[&orgId=]&mode=sellables|shift|tickets[&shiftId=][&limit=]
 *
 * `sellables` — the merged catalog (fin_products ⋈ stk_items) an agent can
 * ring up, trimmed to the fields it needs to build a ticket line.
 * `shift` — the currently open shift (or null) plus its running summary.
 * `tickets` — recent tickets, optionally scoped to one shift; limit capped at 50.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'pos', 'view');
	const mode = url.searchParams.get('mode');

	if (mode === 'sellables') {
		const sellables = await listSellables(ctx);
		return json({
			mode,
			sellables: sellables.map((s) => ({
				productId: s.productId,
				code: s.code,
				name: s.name,
				category: s.category,
				unitPrice: s.unitPrice,
				kind: s.kind,
				stockQty: s.stockQty,
				hasMapping: s.hasMapping,
			})),
		});
	}

	if (mode === 'shift') {
		const open = await getOpenShift(ctx);
		return json({ mode, shift: open?.shift ?? null, summary: open?.summary ?? null });
	}

	if (mode === 'tickets') {
		const limitParam = Number(url.searchParams.get('limit'));
		const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 50;
		const tickets = await listTickets(ctx, { shiftId: url.searchParams.get('shiftId') ?? undefined, limit });
		return json({ mode, tickets });
	}

	return json({ error: `unknown mode '${mode ?? ''}'` }, { status: 400 });
};
