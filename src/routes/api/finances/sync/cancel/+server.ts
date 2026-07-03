import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { requestCancel } from '$server/services/finance-sync-jobs.service';

const postSchema = z.object({ provider: z.string().max(200).optional() });

/** POST /api/finances/sync/cancel { provider } — request a hard cancel (admin). */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  await requestCancel(ctx, provider);
  return json({ ok: true });
};
