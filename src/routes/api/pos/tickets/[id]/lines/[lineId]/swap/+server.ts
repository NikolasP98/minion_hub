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
