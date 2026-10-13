import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { markRead } from '$server/services/inbox/inbox.service';

/** POST /api/inbox/[id]/read — mark one notification read for the caller, plus
 *  every other unread row that shares its click target; `ids` lists every row
 *  actually marked so the client can sync its list without a refetch. */
export const POST: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  const ids = await markRead(ctx, params.id!);
  return json({ ok: true, ids });
};
