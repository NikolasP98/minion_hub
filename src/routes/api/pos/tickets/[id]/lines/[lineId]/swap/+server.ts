import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { swapTicketLineProduct } from '$server/services/pos.service';
import { handlePosError } from '../../../../../_errors';

const swapSchema = z.object({
  productId: z.string().uuid(),
  expectedProductId: z.string().uuid(),
});

/** POST /api/pos/tickets/:id/lines/:lineId/swap — body
 *  `{ productId, expectedProductId }`. Replaces the product of one line on a
 *  submitted sale with another of the same catalogue price; money does not
 *  move and stock follows (meta spec 120, S4). Needs `pos:edit`. */
// TODO(handoff): spec 124 T015/T017 — delegate this route to the shared correction engine
// (POST /api/stock/corrections with reason/key/previewHash/payloadHash, typed refresh_required for old
// tabs) together with the ticket PageBody reason/preview UI. Left on the legacy swap on purpose until
// delegation and the UI are tested; see meta proposals/2026-11-17-hub-stock-correction-handoff.md.
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const body = await parseBody(request, swapSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const result = await swapTicketLineProduct(ctx, params.id!, params.lineId!, body, actor);
    return json({ ok: true, ...result });
  } catch (e) {
    return handlePosError(e);
  }
};
