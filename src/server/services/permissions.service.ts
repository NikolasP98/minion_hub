import { error } from '@sveltejs/kit';
import { getPermissionsForUser } from './roles.service';
import type { LoadCtx } from './types';

export interface PermissionsLoadResult {
  permissions: string[];
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
  const perms = await getPermissionsForUser(ctx.tenantCtx, userId);
  return { permissions: [...perms] };
}
