import type { LayoutServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { loadPermissionsForUser } from '$server/services/permissions.service';
import { requiredViewPermForPath } from '$lib/permissions';
import { loadWorkspacesForUser } from '$server/services/workspaces.service';
import { loadOrganizationsForUser } from '$server/services/organizations.service';
import { loadPersonalAgentForUser } from '$server/services/personal-agent.service';
import { loadHostsForUser } from '$server/services/hosts.service';
import { loadUserPreferences } from '$server/services/preferences.service';
import { getDb } from '$server/db/client';
import { resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listBrainAgentIds } from '$server/services/brain-agents.service';

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

  // Defensive org-activation: hooks.server.ts seeds locals.tenantCtx + orgId
  // whenever the user has a resolvable org. Only when it COULDN'T (no tenantCtx)
  // do we look one up here, or fail clearly if the user has no memberships.
  // (The old `!locals.session?.activeOrganizationId` guard was Better-Auth cruft:
  // Supabase mode never sets a session row, so it was always true and forced a
  // redundant resolveSupabaseTenant round-trip on every app page load.)
  if (!locals.tenantCtx) {
    // Tenancy source of truth = Supabase organization_members (keyed by profile
    // uuid). The active_org cookie carries an explicit org selection.
    const preferredOrgId = cookies.get('active_org') ?? null;
    const orgId = user.supabaseId
      ? (await resolveSupabaseTenant(user.supabaseId, preferredOrgId))?.orgId
      : undefined;

    if (!orgId) {
      throw redirect(303, '/join');
    }
    // Seed locals for THIS request so the bundle queries below see the org. The
    // Turso db handle stays on the ctx for telemetry/servers reads; tenantId is
    // the canonical Supabase org id. (Better-Auth session.activeOrganizationId
    // persistence was removed — Supabase mode has no Turso session row.)
    locals.orgId = orgId;
    locals.tenantCtx = { db: getDb(), tenantId: orgId };
  }

  const [permissions, workspaces, organizations, personalAgent, hosts, preferences, brainAgentIds] =
    await Promise.all([
      loadPermissionsForUser(locals, user.id),
      loadWorkspacesForUser(locals, user.supabaseId),
      loadOrganizationsForUser(locals, user.id),
      loadPersonalAgentForUser(locals, user.id, user.supabaseId),
      loadHostsForUser(locals, user.id, user.role),
      loadUserPreferences(locals, user.supabaseId),
      // Provisioned brain agents (brain-<uuid>) don't have org-shaped names, so
      // the client-side agent-org partition (agent-org.ts) can't place them by
      // name alone — feed it the active org's real assignment instead. Fail-soft:
      // never let a brains-table hiccup break the whole app shell's load.
      getCoreCtx(locals)
        .then((ctx) => (ctx ? listBrainAgentIds(ctx) : []))
        .catch(() => [] as string[]),
    ]);

  // Central RBAC route guard: business modules (crm/finances/sales/scheduling/
  // support/memberships/workforce) require the matching `*:view` capability.
  // Reuses the permission set already resolved above (no extra round-trip);
  // platform admins get every business `*:view` so they pass. This is the real
  // server-side enforcement — the nav `requires` keys only hide the links.
  const requiredPerm = requiredViewPermForPath(url.pathname);
  if (requiredPerm && !permissions.permissions.includes(requiredPerm)) {
    throw error(403, 'You do not have access to this module.');
  }

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
    brainAgentIds,
  };
};
