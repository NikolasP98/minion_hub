import { page } from '$app/state';
import { can } from './policy';
import { canAccessRoute, type RouteAccessContext } from '$lib/routes/route-access-policies';
import { resolveModuleForPath } from '$lib/modules/availability';
import { isModuleVisibleForKind, type OrgKind } from '$lib/org-kind';

interface ClientAccessData {
  user?: { role?: 'user' | 'admin' } | null;
  permissions?: { permissions?: string[] } | null;
  activeOrgKind?: OrgKind | null;
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
 *
 * Also applies org-kind visibility (S3/WP1 R2/R6): the command palette, nav
 * hotkey chords (GNav.svelte), and SettingsNav all route through this one
 * function, so kind-hidden modules (Team/Stock/POS/Workforce/… for personal
 * orgs) stop being offered client-side without duplicating the check at each
 * call site. Kind-only (no moduleStates) — the toggle-state gate stays
 * server-side via `locals.moduleStates`/the hook guard; this is a UI-offer
 * check, not the enforcement boundary.
 */
export function canViewPath(path: string): boolean {
  const kind = accessData().activeOrgKind;
  const match = resolveModuleForPath(path.split(/[?#]/, 1)[0] || '/');
  if (match && !isModuleVisibleForKind(match.moduleId, kind)) return false;
  return canAccessRoute(path, routeAccessContext());
}
