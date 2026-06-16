import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { error } from '@sveltejs/kit';
import { listPendingRequests } from '$server/services/join/requests.service';
import type { JoinRequestRow } from '$server/services/join/requests.service';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
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

  return { requests };
};
