import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { cancelEntry } from '$server/services/stock.service';
import { handleStockError } from '../../../_errors';

/** POST /api/stock/entries/:id/cancel — inserts reversing ledger rows, never deletes. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  try {
    const entry = await cancelEntry(ctx, params.id!, actor);
    return json(entry);
  } catch (e) {
    handleStockError(e);
  }
};
