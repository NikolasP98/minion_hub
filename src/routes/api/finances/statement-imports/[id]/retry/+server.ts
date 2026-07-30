import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { retryImport, requirePersonalOrg } from '$server/services/finance-statements.service';

/** POST /api/finances/statement-imports/:id/retry — reuse the same import;
 *  resumes from its existing next_chunk (no-op unless status is 'failed' or
 *  'undone'; an undone import restarts from chunk 0). */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  await requirePersonalOrg(ctx);

  const row = await retryImport(ctx, params.id!);
  if (!row) throw error(404);
  return json({ id: row.id, status: row.status });
};
