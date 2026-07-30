import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { error } from '@sveltejs/kit';
import { listPendingRequests } from '$server/services/join/requests.service';
import type { JoinRequestRow } from '$server/services/join/requests.service';
import { isModuleVisibleForKind } from '$lib/org-kind';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { listPending } from '$server/services/pulse.service';
import type { PulseProposalRow } from '$server/db/pg-schema/pulse';

export const load: PageServerLoad = async ({ locals, parent, depends }) => {
  requireAdmin(locals);
  depends('app:notifications');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  // Supabase `join_request` is the system-of-record (Turso is telemetry only).
  const pending = await listPendingRequests(locals.tenantCtx.tenantId);
  const requests = pending.map((r: JoinRequestRow) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    // Supabase created_at is an ISO string; the UI's timeAgo() wants epoch ms.
    createdAt: new Date(r.created_at).getTime(),
  }));

  // Pulse is hidden for business orgs (see ORG_KIND_POLICY) — same rule the
  // /pulse page itself 404s on. Business orgs just get no pulse section here.
  const { activeOrgKind } = await parent();
  let pulseProposals: PulseProposalRow[] = [];
  if (isModuleVisibleForKind('pulse', activeOrgKind)) {
    const ctx = await requireCoreCtx(locals);
    pulseProposals = await listPending(ctx);
  }

  return { requests, pulseProposals };
};
