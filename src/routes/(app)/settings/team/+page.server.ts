import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { listUsers } from '$server/services/user.service';
import { listRoles } from '$server/services/roles.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:team');
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const [rawUsers, customRoles] = await Promise.all([
    listUsers(locals.tenantCtx),
    listRoles(locals.tenantCtx),
  ]);

  // Coerce Date → ISO string so the shape matches the client-side fetch
  // (which goes through JSON serialization) and the existing UserRow type.
  const users = rawUsers.map((u) => ({
    ...u,
    displayName: u.displayName ?? null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));

  return { users, customRoles };
};
