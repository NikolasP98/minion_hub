import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
// Supabase `join_request` is the system-of-record (same source the Team
// approve/deny flow uses). The legacy Turso `joinRequests` table is unused in
// prod, so the old Turso countPendingRequests 500'd this badge endpoint.
import { countPendingRequests } from '$server/services/join/requests.service';

/** GET /api/join-requests/count — returns { count } of pending join requests for the org. */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx || user.role !== 'admin') {
    return json({ count: 0 });
  }

  const count = await countPendingRequests(ctx.tenantId);
  return json({ count });
};
