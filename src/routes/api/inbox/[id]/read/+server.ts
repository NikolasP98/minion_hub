import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { markRead } from '$server/services/inbox/inbox.service';

/** POST /api/inbox/[id]/read — mark one notification read for the caller. */
export const POST: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  await markRead(ctx, params.id!);
  return json({ ok: true });
};
