import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireModuleEnabled } from '$server/http/require-module';
import { undoImport, requirePersonalOrg } from '$server/services/finance-statements.service';

/** POST /api/finances/statement-imports/:id/undo — delete every transaction
 *  persisted for this import and reset it to a clean 'queued' state. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'finances');
  await requirePersonalOrg(ctx);

  const row = await undoImport(ctx, params.id!);
  if (!row) throw error(404);
  return json({ id: row.id, status: row.status });
};
