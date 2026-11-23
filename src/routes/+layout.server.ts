import type { LayoutServerLoad } from './$types';
import { dev } from '$app/environment';
import { isHttpError } from '@sveltejs/kit';
import { resolveBranding } from '$lib/branding';
import { getTenant } from '$server/services/tenant.service';

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
export const load: LayoutServerLoad = async ({ locals, depends, route }) => {
  depends('app:user', 'app:branding');
  let branding = resolveBranding(null);
  if (!route.id?.startsWith('/(app)') && locals.user && locals.tenantCtx) {
    try {
      const tenant = await getTenant(locals.tenantCtx);
      branding =
        tenant?.id === locals.tenantCtx.tenantId
          ? resolveBranding(tenant)
          : { ...resolveBranding(null, 'unavailable'), orgId: locals.tenantCtx.tenantId };
    } catch (cause) {
      if (isHttpError(cause) && [401, 403].includes(cause.status)) throw cause;
      branding = { ...resolveBranding(null, 'unavailable'), orgId: locals.tenantCtx.tenantId };
    }
  }
  return {
    user: locals.user ?? null,
    branding,
    env: { backend: locals.backend, local: dev },
  };
};
