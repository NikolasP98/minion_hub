import { page } from '$app/state';
import { canonicalPath } from '$lib/canonical-path';
import { EMPTY_NAV_CONFIG, resolveNavInstance, type NavConfig } from './custom-sections';

/**
 * Optimistic view while a context-menu save is in flight (set/cleared by nav-edit).
 * Raw, not deep state: edits `structuredClone` the current config, which a proxy refuses.
 */
export const navOptimistic = new (class {
  config = $state.raw<NavConfig | null>(null);
})();

/** The member's filtered nav config (roles stripped), loaded once by the app layout. */
export function navConfig(): NavConfig {
  return (
    navOptimistic.config ?? (page.data as { navConfig?: NavConfig }).navConfig ?? EMPTY_NAV_CONFIG
  );
}

/**
 * Canonical path for nav ACTIVE state: an instance URL (`/staff/sell~k3x9q2/x`)
 * resolves to its target (`/pos/sell/x`) so the target section's side-nav lights up.
 * (Lives here, not in custom-sections-nav.ts, to keep that module free of `$app`.)
 */
export function navPath(): string {
  const path = canonicalPath(page.url.pathname);
  const hit = resolveNavInstance(navConfig(), path);
  return hit ? hit.target + hit.rest : path;
}
