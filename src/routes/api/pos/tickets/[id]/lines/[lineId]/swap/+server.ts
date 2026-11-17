import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { applyStockCorrection } from '$server/services/stock-corrections.service';
import { refreshRequired, swapRefusal, swapRequest } from './_swap-correction';

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const swapSchema = z.object({
  productId: z.string().uuid(),
  expectedProductId: z.string().uuid(),
  reason: z.string().optional(),
  operationKey: z.string().uuid().optional(),
  previewHash: sha.optional(),
  payloadHash: sha.optional(),
});

/** POST /api/pos/tickets/:id/lines/:lineId/swap — apply a previewed swap through the correction engine
 *  (spec 124 T015). Body `{ productId, expectedProductId, reason, operationKey, previewHash, payloadHash }`;
 *  the hashes come from `./preview`. An older client that sends no reason/key/hashes gets a typed
 *  `refresh_required` and nothing is written. Same authority as before: `pos:edit`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const body = await parseBody(request, swapSchema);
  const { reason, operationKey, previewHash, payloadHash } = body;
  if (reason === undefined || !operationKey || !previewHash || !payloadHash)
    return refreshRequired();
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const result = await applyStockCorrection(
      ctx,
      {
        request: swapRequest(params.lineId!, body),
        operationKey,
        previewHash,
        payloadHash,
        reason,
      },
      actor,
      { ticketId: params.id! },
    );
    return json({ ok: true, ...result }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return swapRefusal(e);
  }
};
