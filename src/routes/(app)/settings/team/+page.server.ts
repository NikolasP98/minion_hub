import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { listUsers, listOrganizations } from '$server/services/user.service';
import { listRoles } from '$server/services/roles.service';
import { listPendingRequests } from '$server/services/join-request.service';
import type { JoinRequestRow } from '$server/services/join-request.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:team');
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const [rawUsers, customRoles, pending, organizations] = await Promise.all([
    listUsers(locals.tenantCtx),
    listRoles(locals.tenantCtx),
    listPendingRequests(locals.tenantCtx.db, locals.tenantCtx.tenantId),
    listOrganizations(locals.tenantCtx),
  ]);

  const users = rawUsers.map((u) => ({
    ...u,
    displayName: u.displayName ?? null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  const pendingRequests = pending.map((r: JoinRequestRow) => ({
    id: r.id,
    email: r.email,
    message: r.message,
    createdAt: new Date(r.createdAt).toISOString(),
  }));

  return { users, customRoles, pendingRequests, organizations };
};
