import { page } from '$app/state';
import { can } from './policy';
import { requiredViewPermForPath } from '$lib/permissions';

/** Client-side capability check sourced from `page.data`. */
export function canClient(key: string): boolean {
  const user = (page.data as any)?.user ?? null;
  const perms: string[] = (page.data as any)?.permissions?.permissions ?? [];
  return can(key, user, new Set(perms));
}

/**
 * Can the current user view a route (module OR section sub-resource)? Mirrors the
 * central server route guard (`requiredViewPermForPath`) against the loaded
 * permission set, so section side-menus hide subpage links the role can't view —
 * exactly like the main sidebar hides module links. Ungated paths are always
 * shown.
 */
export function canViewPath(path: string): boolean {
  const perm = requiredViewPermForPath(path);
  if (!perm) return true;
  const perms: string[] = (page.data as any)?.permissions?.permissions ?? [];
  return perms.includes(perm);
}
