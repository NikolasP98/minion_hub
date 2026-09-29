import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { archiveItems } from '$server/services/stock.service';
import { handleStockError } from '../../_errors';

const postSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  archived: z.boolean(),
});

/** POST /api/stock/items/archive — bulk archive/restore (spec Bundle C #5). */
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'stock', 'edit');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const body = await parseBody(request, postSchema);
  try {
    const updated = await archiveItems(ctx, body.ids, body.archived);
    return json({ ok: true, updated });
  } catch (e) {
    handleStockError(e);
  }
};
