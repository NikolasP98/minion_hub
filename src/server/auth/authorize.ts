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
