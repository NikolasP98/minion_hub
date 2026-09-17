import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { hasOrgCapability } from '$server/services/rbac.service';
import { listPendingRequests } from '$server/services/join/requests.service';
import type { JoinRequestRow } from '$server/services/join/requests.service';

/** GET /api/join-requests/pending — returns { requests } of pending join requests.
 *  Fail-soft: returns empty list for anyone without users:manage in their active
 *  org (was platform-admin-only — org owners got an empty badge too) so the
 *  notification popup never crashes the chrome. */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx || !(await hasOrgCapability(locals, 'users', 'manage'))) {
    return json({ requests: [] });
  }

  // Supabase `join_request` is the system-of-record (Turso is telemetry only).
  const pending = await listPendingRequests(ctx.tenantId);
  const requests = pending.map((r: JoinRequestRow) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    // Supabase created_at is an ISO string; the UI's timeAgo() wants epoch ms.
    createdAt: new Date(r.created_at).getTime(),
  }));

  return json({ requests });
};
