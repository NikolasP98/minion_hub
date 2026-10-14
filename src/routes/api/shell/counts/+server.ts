import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { hasOrgCapability, requireOrgCapability } from '$server/services/rbac.service';
import { unreadCount } from '$server/services/inbox/inbox.service';
import { countPendingRequests } from '$server/services/join/requests.service';
import { countPending } from '$server/services/pulse.service';
import { countPosPendingWork } from '$server/services/pos-accounts.service';

/**
 * GET /api/shell/counts — the authenticated-shell badge counts (inbox unread,
 * pending join requests, pending Pulse cards, POS pending work) in ONE request
 * instead of four (`/api/inbox/count`, `/api/join-requests/count`,
 * `/api/pulse/count` — all still exist for their other callers). Mirrors each
 * route's own permission check individually: a caller lacking that field's
 * capability gets `null` for just that field, never a 403 for the whole call.
 *
 * `posPending` is the POS side-menu Accounts badge. It lives here rather than
 * in a layout load because the sidebar renders on EVERY page while
 * `/pos/+layout.server.ts` runs only under /pos — the badge used to vanish the
 * moment you navigated away (owner 2026-10-14). This poll already runs
 * app-wide, so the badge costs one more count on an existing tick instead of a
 * query on every page load.
 */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);

  const [inbox, joinRequests, pulseCount, posPending] = await Promise.all([
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
    (async () => {
      await requireOrgCapability(locals, 'pos', 'view');
      const ctx = await requireCoreCtx(locals);
      return countPosPendingWork(ctx);
    })().catch(() => null),
  ]);

  return json({ inbox, joinRequests, pulse: pulseCount, posPending });
};
