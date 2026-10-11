import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { unreadCount } from '$server/services/inbox/inbox.service';

/** GET /api/inbox/count — unread inbox count for the bell badge (fail-soft 0
 *  for anyone with no active org, mirrors /api/join-requests/count). */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const count = await unreadCount(ctx);
  return json({ count });
};
