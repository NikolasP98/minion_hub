import type { PageServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { error } from '@sveltejs/kit';
import { listPendingRequests } from '$server/services/join/requests.service';
import type { JoinRequestRow } from '$server/services/join/requests.service';
import { isModuleVisibleForKind } from '$lib/org-kind';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listPending } from '$server/services/pulse.service';
import type { PulseProposalRow } from '$server/db/pg-schema/pulse';
import { hasOrgCapability } from '$server/services/rbac.service';
import { listFeed } from '$server/services/inbox/inbox.service';

/** The join-request/pulse review sections are an admin surface (unchanged
 *  behavior); the inbox feed below them is for every signed-in org member. */
export const load: PageServerLoad = async ({ locals, parent, depends }) => {
  requireAuth(locals);
  depends('app:notifications');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const canReviewAccess = await hasOrgCapability(locals, 'users', 'manage');
  let requests: ReturnType<typeof mapRequest>[] = [];
  if (canReviewAccess) {
    // Supabase `join_request` is the system-of-record (Turso is telemetry only).
    const pending = await listPendingRequests(locals.tenantCtx.tenantId);
    requests = pending.map(mapRequest);
  }

  // Pulse is hidden for business orgs (see ORG_KIND_POLICY) — same rule the
  // /pulse page itself 404s on. Business orgs just get no pulse section here.
  const { activeOrgKind } = await parent();
  const ctx = await requireCoreCtx(locals);
  // Pulse review is an admin surface like the join-request review above —
  // the pre-inbox page required admin for both (security review 2026-10-10).
  let pulseProposals: PulseProposalRow[] = [];
  if (canReviewAccess && isModuleVisibleForKind('pulse', activeOrgKind)) {
    pulseProposals = await listPending(ctx);
  }

  const { items: inboxItems } = await listFeed(ctx, { includeResolved: false, limit: 50 });

  return { requests, pulseProposals, inboxItems };
};

function mapRequest(r: JoinRequestRow) {
  return {
    id: r.id,
    email: r.email,
    message: r.message,
    // Supabase created_at is an ISO string; the UI's timeAgo() wants epoch ms.
    createdAt: new Date(r.created_at).getTime(),
    organizationId: r.organization_id,
  };
}
