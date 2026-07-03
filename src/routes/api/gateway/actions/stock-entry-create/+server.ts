import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { createEntry } from '$server/services/stock.service';
import { ENTRY_TYPES } from '$server/services/stock.logic';

const lineSchema = z.object({
	itemId: z.string().min(1),
	qty: z.number().positive(),
	uom: z.string().max(50).nullable().optional(),
	rate: z.number().nonnegative().nullable().optional(),
	fromWarehouseId: z.string().min(1).nullable().optional(),
	toWarehouseId: z.string().min(1).nullable().optional(),
});

const bodySchema = z.object({
	confirm: z.boolean(),
	type: z.enum(ENTRY_TYPES),
	partyId: z.string().max(200).nullable().optional(),
	note: z.string().max(20_000).nullable().optional(),
	lines: z.array(lineSchema).min(1),
});

/**
 * POST /api/gateway/actions/stock-entry-create?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, type, partyId?, note?, lines: [{ itemId, qty, uom?, rate?, fromWarehouseId?, toWarehouseId? }] }
 *
 * Creates a DRAFT stock entry only — submission (which writes the append-only
 * ledger and moves stock) is a deliberate separate step done from the /stock
 * UI, not exposed to the agent in v1.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'stock', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		return json({
			preview: {
				action: 'stock-entry-create',
				type: b.type,
				partyId: b.partyId ?? null,
				note: b.note ?? null,
				lines: b.lines,
			},
		});
	}

	const actor = await agentActor(principalId);
	const entry = await createEntry(
		ctx,
		{
			type: b.type,
			partyId: b.partyId ?? null,
			note: b.note ?? null,
			lines: b.lines,
		},
		actor,
	);
	return json({ entry }, { status: 201 });
};
