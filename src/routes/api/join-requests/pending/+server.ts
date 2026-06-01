import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { listPendingRequests } from '$server/services/join-request.service';
import type { JoinRequestRow } from '$server/services/join-request.service';

/** GET /api/join-requests/pending — returns { requests } of pending join requests.
 *  Fail-soft: returns empty list for non-admin users so the notification popup
 *  never crashes the chrome. */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx || user.role !== 'admin') {
    return json({ requests: [] });
  }

  const pending = await listPendingRequests(ctx.db, ctx.tenantId);
  const requests = pending.map((r: JoinRequestRow) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    createdAt: r.createdAt,
  }));

  return json({ requests });
};
