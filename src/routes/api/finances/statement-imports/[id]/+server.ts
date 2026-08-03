import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getImportStatus, requirePersonalOrg } from '$server/services/finance-statements.service';

/** GET /api/finances/statement-imports/:id — status incl. counts + a bounded
 *  sample of rejected rows (recomputed deterministically, not persisted). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  await requirePersonalOrg(ctx);

  const status = await getImportStatus(ctx, params.id!);
  if (!status) throw error(404);
  return json(status);
};
