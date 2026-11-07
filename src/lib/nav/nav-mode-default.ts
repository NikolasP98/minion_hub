/**
 * Role-derived sidebar mode, shared by the client nav (`nav-mode.svelte.ts`)
 * and the server landing resolver — kept free of `$app/*` so both can import it.
 */
export type NavMode = 'full' | 'module';

/** Org roles that see the full sidebar by default. */
export const FULL_NAV_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'manager']);

/**
 * Role-derived default, used until the user picks a mode explicitly. Unknown
 * roles fall back to the full nav — never hide surfaces on a guess.
 */
export function defaultNavMode(roles: string[] | undefined, platformRole?: string): NavMode {
  if (platformRole === 'admin') return 'full';
  if (!roles || roles.length === 0) return 'full';
  return roles.some((r) => FULL_NAV_ROLES.has(r)) ? 'full' : 'module';
}
