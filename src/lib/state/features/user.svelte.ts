import { authClient } from '$lib/auth';
import { env } from '$env/dynamic/public';

type UserRole = 'user' | 'admin';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
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
      state.orgId = (session.data.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;

      // Auto-activate first org if session exists but no activeOrganizationId
      if (!state.orgId) {
        try {
          const orgs = await authClient.organization.list();
          const firstOrg = orgs.data?.[0];
          if (firstOrg) {
            await authClient.organization.setActive({ organizationId: firstOrg.id });
            state.orgId = firstOrg.id;
          }
        } catch { /* non-fatal */ }
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
  } catch { /* non-fatal, default to showing nothing */ }
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
