import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listAccruals } from '$server/services/stock-accruals.service';

/** GET /api/stock/accruals?status=&itemId=&source=&sourceId= — commitments list. */
export const GET: RequestHandler = async ({ locals, url }) => {
	const ctx = await getCoreCtx(locals);
	if (!ctx) throw error(401);
	if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
	const accruals = await listAccruals(ctx, {
		status: url.searchParams.get('status') ?? undefined,
		itemId: url.searchParams.get('itemId') ?? undefined,
		source: url.searchParams.get('source') ?? undefined,
		sourceId: url.searchParams.get('sourceId') ?? undefined,
	});
	return json({ accruals });
};
