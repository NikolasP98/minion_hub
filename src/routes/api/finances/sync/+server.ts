import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { syncSource } from '$server/services/finance-sync.service';

/** POST /api/finances/sync { provider } — run a manual sync for one connector. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const result = await syncSource(ctx, provider);
  return json(result);
};
