import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { countPendingRequests } from '$server/services/join-request.service';

/** GET /api/join-requests/count — returns { count } of pending join requests for the org. */
export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw error(401);
  if (user.role !== 'admin') throw error(403);

  const count = await countPendingRequests(ctx.db, ctx.tenantId);
  return json({ count });
};
