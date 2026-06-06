import { error } from '@sveltejs/kit';
import { getPermissionsForUser } from './roles.service';
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
  userId: string,
): Promise<PermissionsLoadResult> {
  if (!ctx.tenantCtx) throw error(401, 'Authentication required');

  // Cloud/Supabase mode: permissions are derived from the Supabase profile role
  // (`ctx.user.role`), keeping the login bundle off Turso. Custom roles are a
  // self-host/better-auth feature (`role_permissions` is empty in cloud), so the
  // Turso `getPermissionsForUser` read only runs when there's no supabase
  // identity. Behavior-preserving: the role-derived set matches the legacy
  // fallback path that the cloud users already hit.
  if (ctx.user?.supabaseId) {
    return { permissions: [...derivePermissionsFromRole(ctx.user.role)] };
  }

  const perms = await getPermissionsForUser(ctx.tenantCtx, userId);
  return { permissions: [...perms] };
}
