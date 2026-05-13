import { authClient } from '$lib/auth';
import { env } from '$env/dynamic/public';
import { invalidate } from '$app/navigation';

type UserRole = 'user' | 'admin';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Shape returned by `/api/me` AND by `LayoutServerLoad` (locals.user).
 * Both paths share these fields.
 */
export interface ServerUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
}

interface UserState {
  user: CurrentUser | null;
  role: UserRole | null;
  orgId: string | null;
  loading: boolean;
  error: string | null;
  allowedAgentIds: Set<string> | null; // null = no filtering (admin)
}

const state = $state<UserState>({
  user: null,
  role: null,
  orgId: null,
  loading: false,
  error: null,
  allowedAgentIds: null,
});

export const userState = state;

export const isAdmin = {
  get value() {
    return state.role === 'admin';
  },
};

/**
 * Sync the rune state from a fresh `LayoutServerLoad` payload. Call this from
 * `+layout.svelte` inside an `$effect(() => data.user)` so every re-run of the
 * server load (initial + invalidation) reflows into the rune state, keeping all
 * 17+ consumers (`isAdmin.value`, `userState.role`, etc.) automatically fresh.
 *
 * If `data` is null (unauthenticated), clears the user state.
 */
export function hydrateUser(data: ServerUser | null): void {
  if (!data) {
    state.user = null;
    state.role = null;
    state.orgId = null;
    return;
  }
  state.user = {
    id: data.id,
    email: data.email,
    displayName: data.displayName,
  };
  state.role = data.role;
}

/**
 * Force a re-fetch of `LayoutServerLoad` data. Call after any client action that
 * could change the user's role / displayName / alias / etc. on the server —
 * profile edit, admin-grants-role, identity link, etc. The layout load re-runs,
 * which re-reads `locals.user` (which `hooks.server.ts` populates with a fresh
 * DB SELECT every request), and the resulting `data.user` flows back into the
 * rune state via the layout's `$effect`.
 */
export async function invalidateUser(): Promise<void> {
  await invalidate('app:user');
}

export async function loadUser() {
  if (env.PUBLIC_AUTH_DISABLED === 'true') {
    state.user = { id: 'local', email: 'local@dev', displayName: 'Local Dev' };
    state.role = 'admin';
    state.orgId = 'local';
    state.loading = false;
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const session = await authClient.getSession();
    if (session.data?.user) {
      const u = session.data.user;
      state.user = {
        id: u.id,
        email: u.email,
        displayName: u.name ?? null,
      };
      state.orgId =
        (session.data.session as { activeOrganizationId?: string | null }).activeOrganizationId ??
        null;

      // Auto-activate first org if session exists but no activeOrganizationId
      if (!state.orgId) {
        try {
          const orgs = await authClient.organization.list();
          const firstOrg = orgs.data?.[0];
          if (firstOrg) {
            await authClient.organization.setActive({ organizationId: firstOrg.id });
            state.orgId = firstOrg.id;
          }
        } catch {
          /* non-fatal */
        }
      }

      // Fetch role from /api/me
      try {
        const res = await fetch('/api/me');
        if (res.ok) {
          const data = await res.json();
          state.role = data.role ?? 'user';
        } else {
          state.role = 'user';
        }
      } catch {
        state.role = 'user';
      }
    } else {
      state.user = null;
      state.role = null;
      state.orgId = null;
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Failed to load user';
  } finally {
    state.loading = false;
  }
}

export async function loadAllowedAgents(serverId: string) {
  if (state.role === 'admin') {
    state.allowedAgentIds = null; // admin sees all
    return;
  }
  if (!state.user) return;
  try {
    const res = await fetch(`/api/users/${state.user.id}/agents?serverId=${serverId}`);
    if (res.ok) {
      const data = await res.json();
      state.allowedAgentIds = new Set(data.agentIds ?? []);
    }
  } catch {
    /* non-fatal, default to showing nothing */
  }
}

export async function logout() {
  try {
    await authClient.signOut();
  } finally {
    window.location.href = '/login';
  }
}

export function getUserInitials(user: CurrentUser): string {
  if (user.displayName) {
    return user.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return user.email.slice(0, 2).toUpperCase();
}
