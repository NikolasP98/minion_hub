import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { hasOrgCapability, requireOrgCapability } from '$server/services/rbac.service';
import { unreadCount } from '$server/services/inbox/inbox.service';
import { countPendingRequests } from '$server/services/join/requests.service';
import { countPending } from '$server/services/pulse.service';

/**
 * GET /api/shell/counts — the three authenticated-shell badge counts (inbox
 * unread, pending join requests, pending Pulse cards) in ONE request instead
 * of three (`/api/inbox/count`, `/api/join-requests/count`, `/api/pulse/count`
 * — all still exist for their other callers). Mirrors each route's own
 * permission check individually: a caller lacking that field's capability
 * gets `null` for just that field, never a 403 for the whole call.
 */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);

  const [inbox, joinRequests, pulseCount] = await Promise.all([
    requireCoreCtx(locals)
      .then((ctx) => unreadCount(ctx))
      .catch(() => null),
    (async () => {
      const ctx = await getTenantCtx(locals);
      if (!ctx || !(await hasOrgCapability(locals, 'users', 'manage'))) return 0;
      return countPendingRequests(ctx.tenantId);
    })().catch(() => null),
    (async () => {
      await requireOrgCapability(locals, 'pulse', 'view');
      const ctx = await requireCoreCtx(locals);
      return countPending(ctx);
    })().catch(() => null),
  ]);

  return json({ inbox, joinRequests, pulse: pulseCount });
};
