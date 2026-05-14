import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { listRoles } from '$server/services/roles.service';
import { groupPermissions } from '$lib/permissions';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:roles');
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const roles = await listRoles(locals.tenantCtx);
  const catalog = groupPermissions();

  return { roles, catalog };
};
