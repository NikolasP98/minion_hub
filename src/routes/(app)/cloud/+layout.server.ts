import type { LayoutServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';

export const load: LayoutServerLoad = async ({ locals }) => {
  // Resolve remote role assignments + overrides once. requireOrgCapability
  // already returns the effective snapshot; calling hasOrgCapability twice
  // more repeated every Supabase query and could leave /cloud/__data waiting on
  // three independent network chains. Platform admins return null and have all
  // workspace capabilities by definition.
  const capabilities = await requireOrgCapability(locals, 'workspace', 'view');
  const canConnect = capabilities?.can('workspace', 'edit') ?? true;
  const canManage = capabilities?.can('workspace', 'manage') ?? true;
  return {
    canConnect,
    canManage,
    cloudOrgId: locals.orgId ?? locals.tenantCtx?.tenantId ?? null,
  };
};
