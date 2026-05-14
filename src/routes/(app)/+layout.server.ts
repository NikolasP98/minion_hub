import type { LayoutServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { loadPermissionsForUser } from '$server/services/permissions.service';
import { loadWorkspacesForUser } from '$server/services/workspaces.service';
import { loadPersonalAgentForUser } from '$server/services/personal-agent.service';
import { loadHostsForUser } from '$server/services/hosts.service';
import { loadUserPreferences } from '$server/services/preferences.service';

/**
 * Authenticated (app)/* layout server load.
 *
 * Returns a single bundle that powers the client-side feature stores
 * (`userState`, `permissionsState`, `hostsState`, `workspacesState`,
 * `personalAgentState`, `preferencesState`) without any post-mount
 * fetches. This eliminates the OAuth-transition 401 race where the
 * SPA fired 6+ parallel `/api/*` fetches before the session cookie
 * context was fully resolved.
 *
 * Each domain gets its own `depends()` key so client code can call
 * `invalidate('app:permissions')`, `invalidate('app:hosts')`, etc.
 * for targeted re-fetches without reloading the whole bundle.
 *
 * Org auto-activation: previously done client-side in `loadUser()`,
 * the login + OAuth callback flows already invoke
 * `authClient.organization.setActive(...)` on first sign-in, so this
 * server-load relies on those entry points. If we observe sessions
 * landing here without an `activeOrganizationId` (e.g. legacy users),
 * add a defensive call to `getAuth().api.setActiveOrganization(...)`
 * here. Tracked as a follow-up trade-off in the spec.
 */
export const load: LayoutServerLoad = async ({ locals, depends }) => {
  depends(
    'app:user',
    'app:permissions',
    'app:workspaces',
    'app:personalAgent',
    'app:hosts',
    'app:preferences',
  );

  const user = requireAuth(locals);

  const [permissions, workspaces, personalAgent, hosts, preferences] = await Promise.all([
    loadPermissionsForUser(locals, user.id),
    loadWorkspacesForUser(locals, user.id),
    loadPersonalAgentForUser(locals, user.id),
    loadHostsForUser(locals, user.id, user.role),
    loadUserPreferences(locals, user.id),
  ]);

  return {
    user,
    permissions,
    workspaces,
    personalAgent,
    hosts,
    preferences,
  };
};
