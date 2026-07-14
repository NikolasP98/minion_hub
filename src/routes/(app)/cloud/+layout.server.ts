import type { LayoutServerLoad } from './$types';
import { hasOrgCapability, requireOrgCapability } from '$server/services/rbac.service';

export const load: LayoutServerLoad = async ({ locals }) => {
  await requireOrgCapability(locals, 'workspace', 'view');
  const [canConnect, canManage] = await Promise.all([
    hasOrgCapability(locals, 'workspace', 'edit'),
    hasOrgCapability(locals, 'workspace', 'manage'),
  ]);
  return {
    canConnect,
    canManage,
    cloudOrgId: locals.orgId ?? locals.tenantCtx?.tenantId ?? null,
  };
};
