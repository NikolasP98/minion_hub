import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all service load helpers BEFORE importing the module under test.
vi.mock('$server/services/permissions.service', () => ({
  loadPermissionsForUser: vi.fn(async () => ({ permissions: ['perm.a', 'perm.b'] })),
}));
vi.mock('$server/services/workspaces.service', () => ({
  loadWorkspacesForUser: vi.fn(async () => [
    { companyId: 'c1', role: 'admin', name: 'Acme' },
  ]),
}));
vi.mock('$server/services/personal-agent.service', () => ({
  loadPersonalAgentForUser: vi.fn(async () => ({ agent: null })),
}));
vi.mock('$server/services/hosts.service', () => ({
  loadHostsForUser: vi.fn(async () => ({ servers: [], authoritative: true as const })),
}));
vi.mock('$server/services/preferences.service', () => ({
  loadUserPreferences: vi.fn(async () => ({ preferences: {} })),
}));

// `requireAuth` lives in $server/auth/authorize. Import the real module so
// it throws the real SvelteKit 401 when `locals.user` is missing.
import { load } from './+layout.server';

function makeEvent(overrides: Partial<{ user: unknown; session: unknown }> = {}) {
  return {
    locals: {
      user: overrides.user,
      session: overrides.session,
      tenantCtx: { db: {} as never, tenantId: 'tenant-x' },
    } as never,
    depends: vi.fn(),
    request: new Request('http://localhost/'),
    // pad fields SvelteKit normally provides — load only touches `locals`/`depends`
    url: new URL('http://localhost/'),
    params: {},
    route: { id: '/(app)' },
    fetch: globalThis.fetch,
    setHeaders: vi.fn(),
    cookies: {} as never,
    getClientAddress: () => '127.0.0.1',
    isDataRequest: false,
    isSubRequest: false,
    platform: undefined,
  };
}

describe('(app)/+layout.server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the full auth bundle for an authenticated user', async () => {
    const user = { id: 'u-1', email: 'a@b.com', role: 'admin', name: 'A' };
    const ev = makeEvent({ user }) as unknown as Parameters<typeof load>[0];
    const out = await load(ev);
    expect(out).toEqual({
      user,
      permissions: { permissions: ['perm.a', 'perm.b'] },
      workspaces: [{ companyId: 'c1', role: 'admin', name: 'Acme' }],
      personalAgent: { agent: null },
      hosts: { servers: [], authoritative: true },
      preferences: { preferences: {} },
    });
    // depends() should register all six keys
    expect(ev.depends).toHaveBeenCalledWith(
      'app:user',
      'app:permissions',
      'app:workspaces',
      'app:personalAgent',
      'app:hosts',
      'app:preferences',
    );
  });

  it('throws when locals.user is not set (requireAuth gate)', async () => {
    const ev = makeEvent({ user: undefined }) as unknown as Parameters<typeof load>[0];
    await expect(load(ev)).rejects.toMatchObject({ status: 401 });
  });
});
