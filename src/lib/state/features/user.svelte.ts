import { page } from '$app/state';
import { invalidate } from '$app/navigation';
import { authClient } from '$lib/auth';
import { env as publicEnv } from '$env/dynamic/public';
import { supabaseBrowser } from '$lib/supabase/client';

type UserRole = 'user' | 'admin';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Canonical user state. Read-only getters that derive from `page.data`, which
 * is populated by `(app)/+layout.server.ts` (auth bundle: user, permissions,
 * workspaces, hosts, preferences, personalAgent).
 *
 * Replaces the previous module-scoped `$state` rune — server load + page.data
 * now drives every auth-derived value, so `invalidate('app:user')` (etc.) is
 * the single mechanism for refreshing client state after a mutation.
 *
 * The `(page.data as any)` casts here are a pragmatic shortcut — SvelteKit's
 * generated `LayoutData` is hard to reference from inside `$lib`, and the
 * shape is stable per the layout-server contract.
 */
export const userState = {
  get user(): CurrentUser | null {
    const u = (page.data as any)?.user;
    return u ? { id: u.id, email: u.email, displayName: u.displayName ?? null } : null;
  },
  get role(): UserRole | null {
    return ((page.data as any)?.user?.role as UserRole) ?? null;
  },
  get orgId(): string | null {
    return ((page.data as any)?.user?.orgId as string) ?? null;
  },
  get allowedAgentIds(): Set<string> | null {
    const ids = (page.data as any)?.permissions?.allowedAgentIds;
    return ids ? new Set(ids) : null;
  },
};

export const isAdmin = {
  get value(): boolean {
    return ((page.data as any)?.user?.role) === 'admin';
  },
};

/**
 * Force a re-fetch of `LayoutServerLoad` data. Call after any client action
 * that could change the user / permissions / workspaces / hosts / preferences /
 * personalAgent on the server — the layout load re-runs, `locals.user` is
 * re-read fresh from the DB, and the result flows into `page.data` so every
 * getter above sees the new value automatically.
 */
export async function invalidateUser(): Promise<void> {
  await invalidate('app:user');
}

export async function invalidatePermissions(): Promise<void> {
  await invalidate('app:permissions');
}

export async function invalidateWorkspaces(): Promise<void> {
  await invalidate('app:workspaces');
}

export async function invalidateHosts(): Promise<void> {
  await invalidate('app:hosts');
}

export async function invalidatePreferences(): Promise<void> {
  await invalidate('app:preferences');
}

export async function invalidatePersonalAgent(): Promise<void> {
  await invalidate('app:personalAgent');
}

export async function logout(): Promise<void> {
  try {
    // Clear the active provider's session. In supabase mode the session is a
    // Supabase cookie — signing out of Better Auth alone leaves it intact, so
    // the /login redirect would bounce straight back to the app.
    if (publicEnv.PUBLIC_AUTH_PROVIDER === 'supabase') {
      await supabaseBrowser().auth.signOut();
    } else {
      await authClient.signOut();
    }
  } finally {
    window.location.href = '/login';
  }
}

export function getUserInitials(user: { displayName: string | null; email: string }): string {
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
