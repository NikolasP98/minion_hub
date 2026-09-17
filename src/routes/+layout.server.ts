import type { LayoutServerLoad } from './$types';
import { dev } from '$app/environment';

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
 *
 * `env` (spec 2026-09-16-hub-minion-run-dev-switcher §2.1) carries the
 * DEV/PRD backend mode + whether this is a local dev server. It's set here —
 * the ancestor of every route, including `/login` — rather than duplicated
 * in `(app)/+layout.server.ts` and the login page's own load, so the Topbar
 * badge can render before login with one source of truth.
 */
export const load: LayoutServerLoad = ({ locals, depends }) => {
  depends('app:user');
  return {
    user: locals.user ?? null,
    env: { backend: locals.backend, local: dev },
  };
};
