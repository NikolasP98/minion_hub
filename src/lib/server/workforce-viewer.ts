import { resolveCapabilities } from '$server/services/rbac.service';

/**
 * Resolve role keys from the authenticated Hub tenant context. Returning an
 * empty set is intentional: callers must fail role-target behavior closed when
 * Supabase role resolution is unavailable.
 */
export async function trustedWorkforceViewerRoleKeys(locals: App.Locals): Promise<string[]> {
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  const profileId = locals.user?.supabaseId ?? null;
  if (!orgId || !profileId) return [];
  try {
    return (await resolveCapabilities(orgId, profileId)).roles;
  } catch (cause) {
    console.warn('[workforce] failed to resolve trusted viewer roles', cause);
    return [];
  }
}
