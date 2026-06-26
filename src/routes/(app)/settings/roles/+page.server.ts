import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	listRbacRoles,
	requireOrgCapability,
	ACTIONS,
	BUSINESS_MODULES,
	MODULE_LABELS,
	MODULES,
} from '$server/services/rbac.service';

/**
 * Role Permission Manager — surfaces the RBAC system (rbac.service): the built-in
 * role catalog with each role's effective module×action matrix and member counts
 * for the active org. Admins customise per-org by toggling cells (writes
 * permission_rules overrides via /api/roles/overrides).
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
	depends('settings:roles');
	await requireOrgCapability(locals, 'users', 'manage');
	if (!locals.tenantCtx) throw error(401, 'tenant context required');

	const roles = await listRbacRoles(locals.tenantCtx.tenantId);
	const adminModules = MODULES.filter((m) => m !== 'overview' && !BUSINESS_MODULES.includes(m));

	return {
		roles,
		actions: [...ACTIONS],
		// module grouping for the matrix UI (overview shown with business)
		businessModules: ['overview', ...BUSINESS_MODULES],
		adminModules,
		moduleLabels: MODULE_LABELS,
	};
};
