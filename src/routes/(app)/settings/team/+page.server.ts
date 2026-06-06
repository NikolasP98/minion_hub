import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { listUsers, listOrganizations } from '$server/services/user.service';
import { listRoles } from '$server/services/roles.service';
import { listPendingRequests } from '$server/services/join/requests.service';

/**
 * Degrade a loader that hits an un-migrated Turso table to an empty result
 * instead of 500ing the whole admin page. Prod Turso never got the `roles`/
 * `rolePermissions`/`joinRequests` tables (that admin-team domain is still
 * mid-migration); join requests are read from Supabase below.
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
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  const ctx = locals.tenantCtx;

  const [rawUsers, customRoles, pending, organizations] = await Promise.all([
    safe(listUsers(ctx), [] as Awaited<ReturnType<typeof listUsers>>, 'listUsers'),
    safe(listRoles(ctx), [] as Awaited<ReturnType<typeof listRoles>>, 'listRoles'),
    // Supabase join_request is the system-of-record (the /join form + the
    // approve→organization_members grant both use it).
    safe(
      listPendingRequests(),
      [] as Awaited<ReturnType<typeof listPendingRequests>>,
      'listPendingRequests',
    ),
    safe(listOrganizations(ctx), [] as Awaited<ReturnType<typeof listOrganizations>>, 'listOrganizations'),
  ]);

  const users = rawUsers.map((u) => ({
    ...u,
    displayName: u.displayName ?? null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  const pendingRequests = pending.map((r) => {
    const createdRaw = (r as { created_at?: string }).created_at;
    return {
      id: r.id,
      email: r.email,
      message: r.message,
      createdAt: createdRaw ? new Date(createdRaw).toISOString() : new Date().toISOString(),
    };
  });

  return { users, customRoles, pendingRequests, organizations };
};
