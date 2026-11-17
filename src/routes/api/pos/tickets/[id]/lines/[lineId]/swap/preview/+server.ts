import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { previewStockCorrection } from '$server/services/stock-corrections.service';
import { swapRefusal, swapRequest } from '../_swap-correction';

const previewSchema = z.object({
  productId: z.string().uuid(),
  expectedProductId: z.string().uuid(),
  reason: z.string(),
});

/** POST /api/pos/tickets/:id/lines/:lineId/swap/preview — read-only preview of the swap with its reason;
 *  returns the hashes the apply needs. `pos:edit`, like the swap itself. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const body = await parseBody(request, previewSchema);
  try {
    return json(
      await previewStockCorrection(ctx, swapRequest(params.lineId!, body), body.reason, {
        ticketId: params.id!,
      }),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return swapRefusal(e);
  }
};
