import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { buildInvoiceIssuePreview, createIssueFromInvoice } from '$server/services/stock.service';

const lineSchema = z.object({
	itemId: z.string().min(1),
	qty: z.number().positive(),
});

const bodySchema = z.object({
	confirm: z.boolean(),
	invoiceId: z.string().min(1),
	warehouseId: z.string().min(1),
	lines: z.array(lineSchema).optional(),
	submit: z.boolean().optional(),
});

/**
 * POST /api/gateway/actions/stock-issue-from-invoice?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, invoiceId, warehouseId, lines?, submit? }
 *
 * confirm:false — returns the computed preview (consumption-map × invoice qty,
 * plus 1:1 retail fallback) for the agent to relay before committing.
 * confirm:true — creates the issue stk_entry (defaults to the freshly
 * recomputed preview lines when `lines` is omitted); submit:true also posts
 * it (ledger + bins) in the same call.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'stock', 'create');
	const b = await parseBody(request, bodySchema);

	if (!b.confirm) {
		const preview = await buildInvoiceIssuePreview(ctx, b.invoiceId, b.warehouseId);
		return json({
			preview: {
				action: 'stock-issue-from-invoice',
				invoiceId: b.invoiceId,
				warehouseId: b.warehouseId,
				lines: preview.lines,
				unmatched: preview.unmatched,
			},
		});
	}

	const lines = b.lines?.length ? b.lines : (await buildInvoiceIssuePreview(ctx, b.invoiceId, b.warehouseId)).lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
	if (!lines.length) throw error(400, 'no stock lines to issue for this invoice');

	const actor = await agentActor(principalId);
	const entry = await createIssueFromInvoice(ctx, {
		invoiceId: b.invoiceId,
		warehouseId: b.warehouseId,
		lines,
		submit: b.submit,
		actor,
	});
	return json({ entry }, { status: 201 });
};
