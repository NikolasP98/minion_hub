import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { dismiss } from '$server/services/inbox/inbox.service';

/** POST /api/inbox/[id]/dismiss — dismiss one notification for the caller. */
export const POST: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  await dismiss(ctx, params.id!);
  return json({ ok: true });
};
