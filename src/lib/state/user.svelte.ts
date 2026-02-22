import { goto } from '$app/navigation';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface UserState {
  user: CurrentUser | null;
  role: string | null;
  tenantId: string | null;
  loading: boolean;
}

const state = $state<UserState>({
  user: null,
  role: null,
  tenantId: null,
  loading: false,
});

export const userState = state;

export async function loadUser() {
  state.loading = true;
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      state.role = data.role;
      state.tenantId = data.tenantId;
    }
  } finally {
    state.loading = false;
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.role = null;
  state.tenantId = null;
  goto('/login');
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
