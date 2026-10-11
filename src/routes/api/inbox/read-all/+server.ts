import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { readAll } from '$server/services/inbox/inbox.service';

/** POST /api/inbox/read-all — mark every currently-visible unread row read. */
export const POST: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const count = await readAll(ctx);
  return json({ count });
};
