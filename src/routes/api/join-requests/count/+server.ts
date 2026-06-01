import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { countPendingRequests } from '$server/services/join-request.service';

/** GET /api/join-requests/count — returns { count } of pending join requests for the org. */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx || user.role !== 'admin') {
    return json({ count: 0 });
  }

  const count = await countPendingRequests(ctx.db, ctx.tenantId);
  return json({ count });
};
