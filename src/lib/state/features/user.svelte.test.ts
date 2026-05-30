import { describe, test, expect, vi } from 'vitest';

// Mock $app/state to provide page.data
vi.mock('$app/state', () => ({
  page: {
    data: {
      user: { id: 'u1', email: 'a@b.c', displayName: 'Test', role: 'admin', orgId: 'o1' },
      permissions: { allowedAgentIds: ['a1', 'a2'] },
    },
  },
}));

// Mock $app/navigation to avoid SvelteKit runtime requirement
vi.mock('$app/navigation', () => ({
  invalidate: vi.fn(async () => {}),
}));

// Mock $lib/auth so importing user.svelte.ts doesn't pull authClient
vi.mock('$lib/auth', () => ({
  authClient: { signOut: vi.fn(async () => {}) },
}));

// Mock the supabase client + public env so importing user.svelte.ts doesn't
// pull $env/static/public (unresolvable under vitest).
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTH_PROVIDER: 'better-auth' } }));
vi.mock('$lib/supabase/client', () => ({
  supabaseBrowser: () => ({ auth: { signOut: vi.fn(async () => {}) } }),
}));

describe('user.svelte.ts canonical getters', () => {
  test('userState.user reads from page.data', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      displayName: 'Test',
      avatarUrl: null,
      createdAt: null,
    });
  });
  test('userState.role reads from page.data', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.role).toBe('admin');
  });
  test('userState.orgId reads from page.data', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.orgId).toBe('o1');
  });
  test('isAdmin.value is true for role=admin', async () => {
    const { isAdmin } = await import('./user.svelte');
    expect(isAdmin.value).toBe(true);
  });
  test('userState.allowedAgentIds is Set from page.data.permissions', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.allowedAgentIds).toBeInstanceOf(Set);
    expect(userState.allowedAgentIds?.size).toBe(2);
  });
});
