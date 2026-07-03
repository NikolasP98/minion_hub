import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listUsers, listOrganizations } from '$server/services/user.service';
import { listRoleCatalog, getOrgMemberRolesAll, requireOrgCapability } from '$server/services/rbac.service';
import { listPendingRequests } from '$server/services/join/requests.service';

/**
 * Degrade a sub-loader to an empty result instead of 500ing the whole admin page
 * (e.g. a transient Supabase hiccup resolving roles/members). Roles now come from
 * the RBAC tables (member_roles / permission_roles); join requests from Supabase.
 */
async function safe<T>(p: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[settings/team] ${label} failed, degrading to empty:`, err);
    return fallback;
  }
}

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:team');
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  const ctx = locals.tenantCtx;

  const [rawUsers, rbacRoles, memberRoles, pending, organizations] = await Promise.all([
    safe(listUsers(ctx), [] as Awaited<ReturnType<typeof listUsers>>, 'listUsers'),
    safe(listRoleCatalog(), [] as Awaited<ReturnType<typeof listRoleCatalog>>, 'listRoleCatalog'),
    safe(getOrgMemberRolesAll(ctx.tenantId), new Map<string, string[]>(), 'getOrgMemberRolesAll'),
    // Supabase join_request is the system-of-record (the /join form + the
    // approve→organization_members grant both use it).
    safe(
      listPendingRequests(ctx.tenantId),
      [] as Awaited<ReturnType<typeof listPendingRequests>>,
      'listPendingRequests',
    ),
    safe(listOrganizations(ctx), [] as Awaited<ReturnType<typeof listOrganizations>>, 'listOrganizations'),
  ]);

  const users = rawUsers.map((u) => ({
    ...u,
    email: u.email ?? '',
    role: (u.role === 'admin' ? 'admin' : 'user') as 'user' | 'admin',
    // RBAC roles for THIS org (member_roles, multi-role); falls back to viewer if unassigned.
    memberRoles: memberRoles.get(u.id) ?? ['viewer'],
    displayName: u.displayName ?? null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  const pendingRequests = pending.map((r) => {
    const createdRaw = (r as { created_at?: string }).created_at;
    return {
      id: r.id,
      email: r.email,
      message: r.message,
      // The org the requester asked to join (system-of-record for the grant on
      // approval). Carried through so the Team tab can approve without a picker.
      organizationId: r.organization_id ?? null,
      requestedRole: r.requested_role ?? 'user',
      createdAt: createdRaw ? new Date(createdRaw).toISOString() : new Date().toISOString(),
    };
  });

  return { users, rbacRoles, pendingRequests, organizations };
};
