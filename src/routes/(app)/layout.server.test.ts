import { describe, it, expect, vi, beforeEach } from 'vitest';
const telemetry = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('$app/environment', () => ({ building: false, dev: false, browser: false }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_POSTHOG_KEY: 'synthetic-test-key' } }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = telemetry.capture;
    on = vi.fn();
  },
}));

// Mock all service load helpers BEFORE importing the module under test.
vi.mock('$server/services/permissions.service', () => ({
  loadPermissionsForUser: vi.fn(async () => ({ permissions: ['perm.a', 'perm.b'] })),
}));
vi.mock('$server/services/workspaces.service', () => ({
  loadWorkspacesForUser: vi.fn(async () => [{ companyId: 'c1', role: 'admin', name: 'Acme' }]),
}));
vi.mock('$server/services/personal-agent.service', () => ({
  loadPersonalAgentForUser: vi.fn(async () => ({
    agent: { id: 'pa-1', userId: 'u-1', agentId: 'personal-u-1', provisioningStatus: 'active' },
  })),
}));
vi.mock('$server/services/hosts.service', () => ({
  loadHostsForUser: vi.fn(async () => ({ servers: [], authoritative: true as const })),
}));
vi.mock('$server/services/preferences.service', () => ({
  loadUserPreferences: vi.fn(async () => ({ preferences: {} })),
}));
vi.mock('$server/services/organizations.service', () => ({
  loadOrganizationsForUser: vi.fn(async () => ({
    organizations: [
      { id: 'org-1', name: 'Org', slug: null, role: 'admin', onboardedAt: '2026-01-01T00:00:00Z' },
    ],
    activeOrgId: 'org-1',
  })),
}));
vi.mock('$server/services/tenant.service', () => ({
  getTenant: vi.fn(async () => ({ id: 'org-1', name: 'Org', kind: 'business' })),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: vi.fn(async () => ({ db: {} as never, tenantId: 'tenant-x' })),
}));
vi.mock('$server/services/brain-agents.service', () => ({
  listBrainAgentIds: vi.fn(async () => []),
}));
vi.mock('$server/services/table-config.service', () => ({
  readTableConfig: vi.fn(async () => ({})),
}));
vi.mock('$server/services/nav-config.service', () => ({
  readNavConfig: vi.fn(async () => ({
    version: 1,
    sections: [],
    builtinSections: {},
    builtin: {},
  })),
}));

// Defensive org-activation pulls in db + schema; mock these so vitest doesn't
// try to resolve $env/dynamic/private in the test environment.
vi.mock('$server/db/client', () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ orgId: 'tenant-x' }] }) }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  })),
}));
vi.mock('@minion-stack/db/schema', () => ({
  member: { userId: 'user_id', organizationId: 'organization_id' },
  session: { id: 'id' },
}));
// The layout wraps its core loads in the PG pool guards (singleflight
// app-shell gates); pass-through here so no real SUPABASE_DB_URL is needed.
vi.mock('$server/db/pg-client', () => ({
  withCriticalCoreDb: (fn: () => unknown) => fn(),
  withCoreDbRecovery: (fn: () => unknown) => fn(),
  getCoreDb: vi.fn(() => ({})),
}));

// `requireAuth` lives in $server/auth/authorize. Import the real module so
// it throws the real SvelteKit 401 when `locals.user` is missing.
import { load } from './+layout.server';

function makeEvent(
  overrides: Partial<{ user: unknown; session: unknown; orgId: string; orgKind: string }> = {},
) {
  return {
    locals: {
      user: overrides.user,
      session: overrides.session,
      tenantCtx: { db: {} as never, tenantId: 'tenant-x' },
      orgId: overrides.orgId,
      orgKind: overrides.orgKind,
    } as never,
    depends: vi.fn(),
    request: new Request('http://localhost/'),
    // pad fields SvelteKit normally provides — load only touches `locals`/`depends`
    url: new URL('http://localhost/'),
    params: {},
    route: { id: '/(app)' },
    fetch: globalThis.fetch,
    setHeaders: vi.fn(),
    cookies: { get: () => undefined } as never,
    // untrack passthrough — the load wraps its url reads in it (S3 nav-independence)
    untrack: (fn: () => unknown) => fn(),
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
    const user = {
      id: 'u-1',
      email: 'a@b.com',
      role: 'admin',
      name: 'A',
      onboardedAt: '2026-01-01T00:00:00Z',
    };
    // tenantCtx + an active org on the session skip the defensive org-activation
    // block (which now resolves tenancy only via Supabase organization_members).
    const ev = makeEvent({
      user,
      session: { activeOrganizationId: 'tenant-x', id: 's1' },
    }) as unknown as Parameters<typeof load>[0];
    const out = await load(ev);
    expect(out).toEqual({
      user,
      permissions: { permissions: ['perm.a', 'perm.b'] },
      // The sidebar renders on every page, so module states ride this bundle
      // rather than each module's own subtree layout; absent = enabled, the
      // same default the subtree layouts use.
      schedulingEnabled: true,
      stockEnabled: true,
      workspaces: [{ companyId: 'c1', role: 'admin', name: 'Acme' }],
      personalAgent: {
        agent: { id: 'pa-1', userId: 'u-1', agentId: 'personal-u-1', provisioningStatus: 'active' },
      },
      hosts: { servers: [], authoritative: true },
      preferences: { preferences: {} },
      organizations: [
        {
          id: 'org-1',
          name: 'Org',
          slug: null,
          role: 'admin',
          onboardedAt: '2026-01-01T00:00:00Z',
        },
      ],
      activeOrgId: 'org-1',
      activeOrgKind: 'business',
      brainAgentIds: [],
      tableConfig: {},
      navConfig: { version: 1, sections: [], builtinSections: {}, builtin: {} },
    });
    // depends() should register all nine keys
    expect(ev.depends).toHaveBeenCalledWith(
      'app:user',
      'app:permissions',
      'app:workspaces',
      'app:organizations',
      'app:personalAgent',
      'app:hosts',
      'app:preferences',
      'app:table-config',
      'app:nav-config',
    );
  });

  it('skips the redundant organizations lookup when the hook already resolved this org (debloat-b §2)', async () => {
    const { getTenant } = await import('$server/services/tenant.service');
    const user = {
      id: 'u-1',
      email: 'a@b.com',
      role: 'admin',
      name: 'A',
      onboardedAt: '2026-01-01T00:00:00Z',
    };
    const ev = makeEvent({
      user,
      session: { activeOrganizationId: 'tenant-x', id: 's1' },
      // Matches the mocked loadOrganizationsForUser's activeOrgId: 'org-1' —
      // the request hook (resolveIdentity) already resolved this org's kind.
      orgId: 'org-1',
      orgKind: 'personal',
    }) as unknown as Parameters<typeof load>[0];
    const out = await load(ev);
    expect(out).toHaveProperty('activeOrgKind', 'personal');
    expect(getTenant).not.toHaveBeenCalled();
  });

  describe('navConfig (spec 037)', () => {
    const page = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      kind: 'link',
      slug: 'sell',
      label: 'Sell',
      target: '/pos/sell',
      ...over,
    });
    const staffSection = {
      id: 'st4ff1',
      slug: 'staff',
      label: 'Staff',
      pages: [page('k3x9q2'), page('a1b2c3', { kind: 'main' }), page('h1dd3n', { hidden: true })],
    };
    const empty = { version: 1, sections: [], builtinSections: {}, builtin: {} };
    const full = async () => ({ ...empty, sections: [staffSection] });
    const member = { id: 'u-1', email: 'a@b.com', role: 'user', name: 'A', onboardedAt: 'x' };
    const run = async (permissions: string[], read: () => Promise<unknown>) => {
      // The core bundle is single-flighted for a short window; start each load cold.
      (globalThis as { __minionHubInflight?: Map<string, unknown> }).__minionHubInflight?.clear();
      const { loadPermissionsForUser } = await import('$server/services/permissions.service');
      const { readNavConfig } = await import('$server/services/nav-config.service');
      vi.mocked(loadPermissionsForUser).mockResolvedValueOnce({ permissions, roles: [] } as never);
      vi.mocked(readNavConfig).mockImplementationOnce(read as never);
      const ev = makeEvent({
        user: member,
        session: { activeOrganizationId: 'tenant-x', id: 's1' },
      }) as unknown as Parameters<typeof load>[0];
      return (await load(ev)) as { navConfig: { sections: { pages: { id: string }[] }[] } };
    };
    const ids = (out: Awaited<ReturnType<typeof run>>) =>
      out.navConfig.sections.flatMap((s) => s.pages.map((p) => p.id));

    it('ships only the instances (link and main) the member has a page string for', async () => {
      const out = await run(['page:k3x9q2:view', 'page:a1b2c3:view'], full);
      expect(ids(out)).toEqual(['k3x9q2', 'a1b2c3']);
    });

    it('omits instances without a page string', async () => {
      expect((await run(['pos:view'], full)).navConfig.sections).toEqual([]);
    });

    it('ships hidden entries only with settings:manage', async () => {
      const grants = ['page:k3x9q2:view', 'page:h1dd3n:view'];
      expect(ids(await run(grants, full))).toEqual(['k3x9q2']);
      expect(ids(await run([...grants, 'settings:manage'], full))).toEqual(['k3x9q2', 'h1dd3n']);
    });

    it('falls back to the empty config when the read rejects', async () => {
      const out = await run(['page:k3x9q2:view'], async () => {
        throw new Error('db down');
      });
      expect(out.navConfig).toEqual(empty);
    });
  });

  it('throws when locals.user is not set (requireAuth gate)', async () => {
    const ev = makeEvent({ user: undefined }) as unknown as Parameters<typeof load>[0];
    await expect(load(ev)).rejects.toMatchObject({ status: 401 });
  });
});

describe('slow layout telemetry boundary', () => {
  it('exports only the route template and preserves the authenticated load when capture fails', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      telemetry.capture.mockImplementationOnce(() => {
        throw new Error('private-telemetry-error');
      });
      const ev = makeEvent({
        user: { id: 'u-1', role: 'admin', onboardedAt: '2026-01-01T00:00:00Z' },
        session: { activeOrganizationId: 'tenant-x' },
      });
      ev.url = new URL('http://fixture.invalid/crm/customers/private-customer-sentinel');
      let untracked = false;
      let trackedRouteReads = 0;
      ev.untrack = (fn) => {
        untracked = true;
        try {
          return fn();
        } finally {
          untracked = false;
        }
      };
      ev.route = {
        get id() {
          if (!untracked) trackedRouteReads++;
          return '/(app)/crm/customers/[id]';
        },
      };
      const result = await load(ev as unknown as Parameters<typeof load>[0]);
      expect(result).toHaveProperty('user.id', 'u-1');
      expect(trackedRouteReads).toBe(0);
      await vi.dynamicImportSettled();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(telemetry.capture).toHaveBeenCalledOnce();
      expect(telemetry.capture.mock.calls[0][0].properties).toMatchObject({
        route: '/(app)/crm/customers/[id]',
        duration_ms: 10_000,
      });
      expect(JSON.stringify(telemetry.capture.mock.calls)).not.toContain(
        'private-customer-sentinel',
      );
    } finally {
      clock.mockRestore();
      warn.mockRestore();
      telemetry.capture.mockReset();
    }
  });
});
