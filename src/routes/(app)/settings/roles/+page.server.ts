import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { loadRoleSettings } from '$server/services/organization-role-admin.service';
import {
  listRbacRoles,
  requireOrgCapability,
  ACTIONS,
  BUSINESS_MODULES,
  MODULE_LABELS,
  MODULES,
} from '$server/services/rbac.service';

/**
 * Load the active organization catalog and effective permission matrices beside
 * its optional templates and default-member policy. Templates remain separate
 * from assignable roles; legacy organizations keep their existing catalog.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:roles');
  await requireOrgCapability(locals, 'roles', 'view');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');

  const [roles, roleSettings] = await Promise.all([
    listRbacRoles(locals.tenantCtx.tenantId),
    loadRoleSettings(locals.tenantCtx.tenantId),
  ]);
  const adminModules = MODULES.filter((m) => m !== 'overview' && !BUSINESS_MODULES.includes(m));

  return {
    roles,
    roleSettings,
    actions: [...ACTIONS],
    // module grouping for the matrix UI (overview shown with business)
    businessModules: ['overview', ...BUSINESS_MODULES],
    adminModules,
    moduleLabels: MODULE_LABELS,
  };
};
