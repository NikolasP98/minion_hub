import { page } from '$app/state';
import { can } from './policy';

/** Client-side capability check sourced from `page.data`. */
export function canClient(key: string): boolean {
  const user = (page.data as any)?.user ?? null;
  const perms: string[] = (page.data as any)?.permissions?.permissions ?? [];
  return can(key, user, new Set(perms));
}
