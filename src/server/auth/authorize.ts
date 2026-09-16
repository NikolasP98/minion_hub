import { error } from '@sveltejs/kit';
import type { TenantContext } from '$server/services/base';

type AuthUser = NonNullable<App.Locals['user']>;

/**
 * Require an authenticated user. Throws 401 if not logged in.
 * In AUTH_DISABLED mode the hooks set tenantCtx but not user —
 * callers that only need tenantCtx should use requireTenantCtx instead.
 */
export function requireAuth(locals: App.Locals): AuthUser {
  if (!locals.user) throw error(401, 'Authentication required');
  return locals.user;
}

/**
 * Require an authenticated admin user. Throws 401 if not logged in, 403 if not admin.
 *
 * This checks the PLATFORM role (profiles.role), not org membership — an org
 * owner/admin with no platform role fails this. Scheduling's links/event-types
 * handlers used to call this and 403'd every org owner; they now use
 * `requireOrgCapability(locals, 'scheduling', 'manage')` instead (see
 * src/server/services/rbac.service.ts). The ~55 other requireAdmin call sites
 * under src/routes/api/** were spot-audited by path (gateways/servers/users/
 * workflow-defs/backup-config/memberships/join-requests/etc.) and read as
 * platform-admin-appropriate, but were not individually read line-by-line —
 * TODO(handoff): a full per-handler audit of the remaining requireAdmin
 * callers (grep -rl "requireAdmin(" src/routes/api) for the same org-vs-
 * platform misclassification is still open; see proposals/
 * 2026-09-16-hub-requireadmin-audit-followup.md.
 */
export function requireAdmin(locals: App.Locals): AuthUser {
  const user = requireAuth(locals);
  if (user.role !== 'admin') throw error(403, 'Admin access required');
  return user;
}

/**
 * Require tenant context (set by session auth, Bearer token, or AUTH_DISABLED fallback).
 */
export function requireTenantCtx(locals: App.Locals): TenantContext {
  if (!locals.tenantCtx) throw error(401, 'Authentication required');
  return locals.tenantCtx;
}
