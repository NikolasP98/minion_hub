import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { requestCancel } from '$server/services/finance-sync-jobs.service';

/** POST /api/finances/sync/cancel { provider } — request a hard cancel (admin). */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  await requestCancel(ctx, provider);
  return json({ ok: true });
};
