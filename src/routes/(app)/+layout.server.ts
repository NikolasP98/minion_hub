import type { LayoutServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { loadPermissionsForUser } from '$server/services/permissions.service';
import { loadWorkspacesForUser } from '$server/services/workspaces.service';
import { loadOrganizationsForUser } from '$server/services/organizations.service';
import { loadPersonalAgentForUser } from '$server/services/personal-agent.service';
import { loadHostsForUser } from '$server/services/hosts.service';
import { loadUserPreferences } from '$server/services/preferences.service';
import { getDb } from '$server/db/client';
import { member, session as sessionTable } from '@minion-stack/db/schema';
import { resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';

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
 * Defensive org auto-activation: if the session lacks an
 * `activeOrganizationId`, we look up the user's first org membership
 * and activate it server-side via Better Auth. Users with NO
 * memberships get a clear 403 instead of an opaque 401 from a
 * downstream service that requires `tenantCtx`. This guards against
 * sessions that bypass the login/callback/invite client-side
 * `setActive()` flows (legacy users, session-table drift, manual SQL).
 */
export const load: LayoutServerLoad = async ({ locals, depends, url, cookies }) => {
  depends(
    'app:user',
    'app:permissions',
    'app:workspaces',
    'app:organizations',
    'app:personalAgent',
    'app:hosts',
    'app:preferences',
  );

  const user = requireAuth(locals);

  // Defensive org-activation: hooks.server.ts only seeds tenantCtx when the
  // session has an activeOrganizationId. If the session is missing one, look
  // up first org membership and activate, OR fail clearly if no memberships.
  if (!locals.session?.activeOrganizationId || !locals.tenantCtx) {
    const db = getDb();

    // Tenancy source of truth = Supabase organization_members (keyed by profile
    // uuid). Fall back to the legacy Turso `member` table only when there is no
    // Supabase membership (better-auth/self-host, or bake-in lag). On prod both
    // stores resolve the same org id, so this is behavior-preserving.
    const preferredOrgId = cookies.get('active_org') ?? null;
    const supaOrgId = user.supabaseId
      ? (await resolveSupabaseTenant(user.supabaseId, preferredOrgId))?.orgId
      : undefined;
    const orgId =
      supaOrgId ??
      (
        await db
          .select({ orgId: member.organizationId })
          .from(member)
          .where(eq(member.userId, user.id))
          .limit(1)
      )[0]?.orgId;

    if (!orgId) {
      throw redirect(303, '/join');
    } else {

      // Persist activeOrganizationId on the session row so subsequent requests
      // see it via hooks.server.ts. Direct DB update because Better Auth's
      // organization plugin doesn't expose `setActiveOrganization` as a typed
      // server-callable endpoint; the plugin's `setActive` client method
      // resolves to the same row mutation under the hood.
      if (locals.session?.id) {
        try {
          await db
            .update(sessionTable)
            .set({ activeOrganizationId: orgId })
            .where(eq(sessionTable.id, locals.session.id));
        } catch (err) {
          console.warn('[layout-load] session.activeOrganizationId update failed:', err);
        }
      }

      // Seed locals for THIS request so the bundle queries below see the org.
      locals.orgId = orgId;
      locals.tenantCtx = { db, tenantId: orgId };
    }
  }

  const [permissions, workspaces, organizations, personalAgent, hosts, preferences] =
    await Promise.all([
      loadPermissionsForUser(locals, user.id),
      loadWorkspacesForUser(locals, user.supabaseId),
      loadOrganizationsForUser(locals, user.id),
      loadPersonalAgentForUser(locals, user.id),
      loadHostsForUser(locals, user.id, user.role),
      loadUserPreferences(locals, user.supabaseId),
    ]);

  // Redirect to onboarding if user hasn't completed it yet
  if (
    !url.pathname.startsWith('/onboarding') &&
    (!personalAgent.agent || personalAgent.agent.provisioningStatus !== 'active')
  ) {
    throw redirect(303, '/onboarding');
  }

  return {
    user,
    permissions,
    workspaces,
    organizations: organizations.organizations,
    activeOrgId: organizations.activeOrgId,
    personalAgent,
    hosts,
    preferences,
  };
};
