import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { buildServiceIssuePreview, createServiceIssue } from '$server/services/stock.service';

const lineSchema = z.object({
	itemId: z.string().min(1),
	qty: z.number().positive(),
	qtyConsumption: z.number().positive().nullable().optional(),
});

const bodySchema = z.object({
	confirm: z.boolean(),
	finProductId: z.string().min(1),
	quantity: z.number().positive().default(1),
	warehouseId: z.string().min(1),
	partyId: z.string().max(200).nullable().optional(),
	note: z.string().max(20_000).nullable().optional(),
	lines: z.array(lineSchema).optional(),
	submit: z.boolean().optional(),
});

/**
 * POST /api/gateway/actions/stock-issue-from-service?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, finProductId, quantity, warehouseId, partyId?, note?, lines?, submit? }
 *
 * confirm:false — returns the computed consumption preview (stk_consumption ×
 * quantity) for the agent to relay before committing.
 * confirm:true — creates the issue stk_entry for the service performed (defaults
 * to the freshly recomputed preview lines when `lines` is omitted); submit:true
 * also posts it (ledger + bins) in the same call.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'stock', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		const preview = await buildServiceIssuePreview(ctx, { finProductId: b.finProductId, quantity: b.quantity, warehouseId: b.warehouseId });
		return json({
			preview: {
				action: 'stock-issue-from-service',
				finProductId: b.finProductId,
				productName: preview.productName,
				quantity: b.quantity,
				warehouseId: b.warehouseId,
				lines: preview.lines,
				hasMapping: preview.hasMapping,
			},
		});
	}

	const lines = b.lines?.length
		? b.lines
		: (await buildServiceIssuePreview(ctx, { finProductId: b.finProductId, quantity: b.quantity, warehouseId: b.warehouseId })).lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
	if (!lines.length) throw error(400, 'no stock lines to issue for this service');

	const actor = await agentActor(principalId);
	const entry = await createServiceIssue(ctx, {
		finProductId: b.finProductId,
		quantity: b.quantity,
		warehouseId: b.warehouseId,
		partyId: b.partyId ?? null,
		note: b.note ?? null,
		lines,
		submit: b.submit,
		actor,
	});
	return json({ entry }, { status: 201 });
};
