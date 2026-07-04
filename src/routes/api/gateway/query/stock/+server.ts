import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { getBins, getLedger, listConsumption, getItemUomInfo } from '$server/services/stock.service';

/**
 * GET /api/gateway/query/stock?agentId=personal-<uuid>[&orgId=]&mode=levels|movements|valuation|consumption[&itemId=][&warehouseId=][&finProductId=]
 *
 * `levels` (default) — bin quantities, optionally filtered by item/warehouse.
 * `movements` — ledger rows for one item (itemId required), optionally filtered by warehouse.
 * `valuation` — same bins as `levels` plus a summed total (qty * valuationRate).
 * `consumption` — the fin_product → stk_item consumption map, optionally filtered by finProductId/itemId.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { ctx } = await requireAssistantCapability(locals, url, 'stock', 'view');
	const mode = url.searchParams.get('mode') ?? 'levels';
	const itemId = url.searchParams.get('itemId') ?? undefined;
	const warehouseId = url.searchParams.get('warehouseId') ?? undefined;

	if (mode === 'movements') {
		if (!itemId) throw error(400, 'itemId query param is required for mode=movements');
		const ledger = await getLedger(ctx, itemId, warehouseId);
		return json({ mode, ledger });
	}

	if (mode === 'consumption') {
		const finProductId = url.searchParams.get('finProductId') ?? undefined;
		const consumption = await listConsumption(ctx, { finProductId, itemId });
		return json({ mode, consumption });
	}

	const bins = await getBins(ctx, { itemId, warehouseId });
	if (mode === 'valuation') {
		const total = bins.reduce((sum, b) => sum + Number(b.qty) * Number(b.valuationRate), 0);
		return json({ mode, valuation: total, bins });
	}
	const itemInfo = await getItemUomInfo(ctx, [...new Set(bins.map((b) => b.itemId))]);
	const itemInfoById = new Map(itemInfo.map((i) => [i.itemId, i]));
	const levels = bins.map((b) => ({ ...b, ...itemInfoById.get(b.itemId) }));
	return json({ mode: 'levels', bins: levels });
};
