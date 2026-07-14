import { page } from '$app/state';
import { can } from './policy';
import { canAccessRoute, type RouteAccessContext } from '$lib/routes/route-access-policies';

interface ClientAccessData {
  user?: { role?: 'user' | 'admin' } | null;
  permissions?: { permissions?: string[] } | null;
}

function accessData(): ClientAccessData {
  return page.data as ClientAccessData;
}

function routeAccessContext(): RouteAccessContext {
  const data = accessData();
  const role = data.user?.role;
  return {
    authenticated: Boolean(data.user),
    role,
    permissions: new Set(data.permissions?.permissions ?? []),
  };
}

/** Client-side capability check sourced from `page.data`. */
export function canClient(key: string): boolean {
  const data = accessData();
  const user = data.user?.role ? { role: data.user.role } : null;
  const perms = data.permissions?.permissions ?? [];
  return can(key, user, new Set(perms));
}

/**
 * Can the current user perform a write action on a business module? Consults the
 * `<module>:<action>` legacy strings `capsToLegacyPermissions` emits (mirrors the
 * (module, action) pair `apiWriteCapability` enforces server-side for that write
 * API) — so a gated button and its API call read the same matrix.
 */
export function canAct(module: string, action: string): boolean {
  const perms = accessData().permissions?.permissions ?? [];
  return perms.includes(`${module}:${action}`);
}

/**
 * Evaluate a live href through the same route policy registry the server layout,
 * design manifest, global navigation, and command palette consult.
 */
export function canViewPath(path: string): boolean {
  return canAccessRoute(path, routeAccessContext());
}
