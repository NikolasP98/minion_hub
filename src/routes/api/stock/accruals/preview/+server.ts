import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { buildAccrualPreview } from '$server/services/stock-accruals.service';
import { handleStockError } from '../../_errors';

const postSchema = z.object({
	finProductId: z.string().min(1),
	quantity: z.number().positive().default(1),
	warehouseId: z.string().max(200).nullable().optional(),
	excludeSource: z.object({ source: z.string().min(1), sourceId: z.string().min(1) }).nullable().optional(),
});

/**
 * POST /api/stock/accruals/preview — gauge-ready expected-consumption lines for
 * a service, with per-line est cost + committed-elsewhere + ATP. Read-only
 * (POST for the body); used by the booking modal and the complete dialog.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const ctx = await getCoreCtx(locals);
	if (!ctx) throw error(401);
	if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
	const b = await parseBody(request, postSchema);
	try {
		const preview = await buildAccrualPreview(ctx, {
			finProductId: b.finProductId,
			quantity: b.quantity,
			warehouseId: b.warehouseId ?? null,
			excludeSource: b.excludeSource ?? null,
		});
		return json({ preview });
	} catch (e) {
		handleStockError(e);
	}
};
