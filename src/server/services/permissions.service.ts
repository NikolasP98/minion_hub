import { error } from '@sveltejs/kit';
import { PERMISSIONS } from '$lib/permissions';
import type { LoadCtx } from './types';

export interface PermissionsLoadResult {
  permissions: string[];
}

/**
 * Role-derived permission set — the canonical mapping used when there are no
 * custom roles (the cloud/Supabase case; `role_permissions` is empty there).
 * Mirrors the legacy fallback in `getPermissionsForUser` exactly: admin → all
 * permissions, everyone else → the `*:view` read-only subset.
 */
export function derivePermissionsFromRole(role: string | undefined): Set<string> {
  if (role === 'admin') return new Set(PERMISSIONS);
  return new Set(PERMISSIONS.filter((p) => p.endsWith(':view')));
}

/**
 * Load the permission set for a given user, shaped exactly like the
 * `GET /api/users/me/permissions` response body. Callable from both
 * `+server.ts` and `+layout.server.ts`.
 *
 * Throws 401 if there is no tenant context (i.e. caller did not gate on
 * `requireAuth(locals)` / `locals.tenantCtx` first).
 */
export async function loadPermissionsForUser(
  ctx: LoadCtx,
  _userId: string,
): Promise<PermissionsLoadResult> {
  if (!ctx.tenantCtx) throw error(401, 'Authentication required');

  // Supabase Auth (GoTrue) is the sole provider: permissions are derived from the
  // Supabase profile role (`ctx.user.role`), keeping the login bundle off Turso.
  // Custom roles (`role_permissions`) were a self-host/Better-Auth feature, removed
  // in the GoTrue migration; the AUTH_DISABLED dev admin (no supabaseId) also lands
  // here with role 'admin' → all permissions.
  return { permissions: [...derivePermissionsFromRole(ctx.user?.role)] };
}
