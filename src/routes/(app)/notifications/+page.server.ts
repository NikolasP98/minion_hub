import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { error } from '@sveltejs/kit';
import { listPendingRequests } from '$server/services/join-request.service';
import type { JoinRequestRow } from '$server/services/join-request.service';

export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const pending = await listPendingRequests(locals.tenantCtx.db, locals.tenantCtx.tenantId);
  const requests = pending.map((r: JoinRequestRow) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    createdAt: r.createdAt,
  }));

  return { requests };
};
