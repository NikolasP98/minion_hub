import type { LayoutServerLoad } from './$types';

/**
 * Root layout server load. Exposes `locals.user` (populated by hooks.server.ts
 * on every request — including a fresh role read from the DB) to all routes.
 *
 * Registers the `app:user` dependency so any client-side code can force a
 * re-fetch with `invalidate('app:user')` (or the `invalidateUser()` helper
 * in `$lib/state/features/user.svelte`). Use this after:
 *   - admin grants/revokes a role
 *   - the user edits their own profile
 *   - any SQL-side mutation we want to flow through to client state
 *
 * Avoids the "stale role" trap where module-scoped $state set during
 * onMount goes out of sync with the DB.
 */
export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends('app:user');
  return {
    user: locals.user ?? null,
  };
};
