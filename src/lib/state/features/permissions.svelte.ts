import type { Permission } from '$lib/permissions';
import { page } from '$app/state';

/**
 * Permissions flow through the canonical (app)/+layout.server.ts bundle
 * into page.data — no client fetch. Mutations should call
 * `invalidatePermissions()` from `$lib/state/features/user.svelte` to
 * trigger a targeted re-fetch via the `app:permissions` dep key.
 */

function pagePermissions(): string[] {
  const data = page.data as { permissions?: { permissions?: string[] } } | undefined;
  return data?.permissions?.permissions ?? [];
}

/**
 * No-op shim: data is server-loaded. Kept for callsite compatibility
 * (e.g. `(app)/+layout.svelte` onMount). Safe to remove later.
 */
export function ensurePermissions(): void {
  /* no-op */
}

export function can(perm: Permission): boolean {
  return pagePermissions().includes(perm);
}

export function getPermissions(): Set<string> {
  return new Set(pagePermissions());
}
