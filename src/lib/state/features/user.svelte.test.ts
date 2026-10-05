import { beforeEach, describe, test, expect, vi } from 'vitest';

// Match the actual (app)/+layout.server.ts return shape. Organization identity
// is a sibling of user; the old nested fixture masked a production mismatch.
const layout = vi.hoisted(() => ({
  data: {
    user: {
      id: 'u1',
      supabaseId: 'u1',
      email: 'a@b.c',
      displayName: 'Test',
      role: 'admin',
      orgId: undefined as unknown,
    },
    activeOrgId: 'o1' as unknown,
    permissions: { allowedAgentIds: ['a1', 'a2'] },
  },
}));

// Mock $app/state to provide page.data
vi.mock('$app/state', () => ({
  page: layout,
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
  beforeEach(() => {
    layout.data.activeOrgId = 'o1';
    layout.data.user.orgId = undefined;
  });
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
  test('userState.orgId reads the actual top-level layout field', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.orgId).toBe('o1');
  });
  test('same-actor organization changes are visible on the next read', async () => {
    const { userState } = await import('./user.svelte');
    expect(userState.orgId).toBe('o1');
    layout.data.activeOrgId = 'o2';
    expect(userState.orgId).toBe('o2');
    layout.data.activeOrgId = null;
    expect(userState.orgId).toBeNull();
  });
  test.each([undefined, null, '', '  ', 17, false, {}, []])(
    'missing or malformed active organization %j cannot fall back to a nested value',
    async (value) => {
      const { userState } = await import('./user.svelte');
      layout.data.activeOrgId = value;
      layout.data.user.orgId = 'obsolete';
      expect(userState.orgId).toBeNull();
    },
  );
  test('the top-level field wins over a disagreeing obsolete nested value', async () => {
    const { userState } = await import('./user.svelte');
    layout.data.user.orgId = 'obsolete';
    expect(userState.orgId).toBe('o1');
  });
  test('an admitted organization identifier is not rewritten', async () => {
    const { userState } = await import('./user.svelte');
    layout.data.activeOrgId = ' org-byte-preservation ';
    expect(userState.orgId).toBe(' org-byte-preservation ');
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
