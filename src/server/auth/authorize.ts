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
 * src/server/services/rbac.service.ts). `/api/join-links` and
 * `/api/join-requests/**` (admin side) had the same misclassification — fixed
 * 2026-09-16 to `requireOrgCapability(locals, 'users', 'manage')`, org-scoped
 * (see git history for that date). The ~50 other requireAdmin call sites
 * under src/routes/api/** were spot-audited by path (gateways/servers/users/
 * workflow-defs/backup-config/memberships/etc.) and read as
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

const PROFILE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `profileId` is a current member of `orgId`.
 *
 * SECURITY (audits/2026-10-15-agent-harness/E-rbac-parity.md S1): a gateway
 * server token is an org-wide credential, so a gateway caller asking for
 * another profile's data must be held to that gateway's own org. The credential
 * readers behind /api/gateway/google-{adc,identities} filter on `user_id` alone
 * through the service role, so RLS is no backstop and any org's token could
 * otherwise fetch any platform user's decrypted Google refresh token by uuid.
 *
 * `orgId` is the gateway's org as resolved by resolve-identity
 * (`locals.tenantCtx.tenantId` <- `gateway.org_id`), never taken from the
 * request. A non-uuid id fails closed: membership is keyed by profile uuid, so
 * a legacy Turso user id cannot be verified here.
 */
export async function isGatewayOrgMember(orgId: string, profileId: string): Promise<boolean> {
  if (!PROFILE_UUID_RE.test(profileId)) return false;
  // Imported lazily: this module is pulled in by most route handlers, and a
  // static import would put the pg pool in all of their module graphs.
  const { hasCanonicalMembership } = await import('$server/services/canonical-directory.service');
  return hasCanonicalMembership(profileId, orgId);
}
