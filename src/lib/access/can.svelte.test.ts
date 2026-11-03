import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mutable so kind-gating tests below can flip `activeOrgKind` per test without
// re-mocking the module — `page.data` is read fresh at each canViewPath() call.
const enforced = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('$lib/permissions', async (orig) => ({
  ...(await orig<typeof import('$lib/permissions')>()),
  get DATASET_ENFORCED() {
    return enforced.list;
  },
}));

const pageData: {
  navConfig?: unknown;
  user: { role: 'user' | 'admin' };
  permissions: { permissions: string[] };
  activeOrgKind?: 'business' | 'personal' | null;
  entitlements?: { plan: string; features: string[] };
} = {
  // Platform admins receive the full PERMISSIONS set (loadPermissionsForUser
  // short-circuit); users.manage + reliability.monitor are now permission-driven
  // (RBAC-migrated off minRole/super-view), so the perm set must carry them.
  // For canViewPath we include finance:view but NOT finance.purchases:view so the
  // purchases subpage link hides while the section view stays.
  user: { role: 'admin' },
  permissions: {
    permissions: [
      'marketplace:publish',
      'users:manage',
      'reliability:view',
      'finance:view',
      'finance.dashboard:view',
    ],
  },
  activeOrgKind: 'business',
};

vi.mock('$app/state', () => ({
  page: { data: pageData },
}));

// can.svelte now pulls the nav model (route manifest + icon map): a cold transform takes ~30s.
beforeAll(async () => {
  await import('./can.svelte');
}, 180_000);

beforeEach(() => {
  pageData.activeOrgKind = 'business';
  pageData.navConfig = undefined;
  pageData.entitlements = undefined;
  enforced.list = [];
});

describe('canClient', () => {
  test('reads role + permissions from page.data', async () => {
    const { canClient } = await import('./can.svelte');
    expect(canClient('users.manage')).toBe(true);
    expect(canClient('reliability.monitor')).toBe(true);
    expect(canClient('agents.publish')).toBe(true);
  });
});

describe('canViewPath — section subpage gating', () => {
  test('ungated paths always show; subpage hidden when its sub view perm is absent', async () => {
    const { canViewPath } = await import('./can.svelte');
    expect(canViewPath('/overview')).toBe(true); // ungated
    expect(canViewPath('/finances')).toBe(true); // finance:view present
    expect(canViewPath('/finances/invoices')).toBe(true); // no sub-resource → inherits finance:view
    expect(canViewPath('/finances/purchases')).toBe(false); // finance.purchases:view absent
  });
});

// S3/WP1 (specs/2026-07-22-personal-org-differentiation-spec.md R2/R6):
// canViewPath additionally consults org-kind visibility so the command
// palette/hotkeys/SettingsNav stop offering kind-hidden modules.
describe('canViewPath — org-kind gating', () => {
  test('personal org: Team/Stock/POS/Workforce hidden even though RBAC would allow them', async () => {
    pageData.activeOrgKind = 'personal';
    pageData.permissions.permissions = [
      ...pageData.permissions.permissions,
      'stock:view',
      'pos:view',
    ];
    const { canViewPath } = await import('./can.svelte');
    expect(canViewPath('/team')).toBe(false);
    expect(canViewPath('/settings/team')).toBe(false);
    expect(canViewPath('/stock')).toBe(false);
    expect(canViewPath('/pos')).toBe(false);
    expect(canViewPath('/workforce')).toBe(false);
    expect(canViewPath('/support')).toBe(false);
    expect(canViewPath('/sales')).toBe(false);
  });

  test('personal org: kind-neutral paths stay gated by RBAC only', async () => {
    pageData.activeOrgKind = 'personal';
    const { canViewPath } = await import('./can.svelte');
    expect(canViewPath('/overview')).toBe(true);
    expect(canViewPath('/finances')).toBe(true);
  });

  test('business org: Team/Stock/POS/Workforce are visible (RBAC-gated only)', async () => {
    pageData.activeOrgKind = 'business';
    const { canViewPath } = await import('./can.svelte');
    // /team is the HR page: gated by scheduling:view (spec 2026-09-02-hub-team-hr-module),
    // no longer by users:manage — which the fixture has but scheduling:view it lacks.
    expect(canViewPath('/team')).toBe(false);
    const saved = pageData.permissions.permissions;
    pageData.permissions.permissions = [...saved, 'scheduling:view'];
    expect(canViewPath('/team')).toBe(true);
    pageData.permissions.permissions = saved;
  });

  test('query-string hrefs (archetype filters) resolve to no manifest module (kind-neutral)', async () => {
    pageData.activeOrgKind = 'personal';
    const { canViewPath } = await import('./can.svelte');
    // /agents isn't in MODULE_MANIFEST, so kind never enters the decision —
    // canViewPath falls straight through to the existing RBAC result, same
    // as calling it with the plain path.
    expect(canViewPath('/agents?archetype=copilot')).toBe(canViewPath('/agents'));
  });
});

// Spec 037 I1′/I1‴: an instance path is judged on its page grant AND (while the
// transition floor applies) the target module's view — the same predicate resolve
// and the server guards use, so the sidebar never offers a link that would 403.
describe('canViewPath — nav instances', () => {
  const cfg = {
    version: 1,
    sections: [
      {
        id: 'sec001',
        slug: 'staff',
        label: 'Staff',
        pages: [{ id: 'k3x9q2', slug: 'sell', label: 'Sell', kind: 'link', target: '/pos/sell' }],
      },
    ],
    builtinSections: {},
    builtin: {},
  };
  const as = (perms: string[]) => {
    pageData.user = { role: 'user' };
    pageData.permissions = { permissions: perms };
    pageData.navConfig = cfg;
  };

  test('needs the page grant and, while unenforced, the module floor', async () => {
    const { canViewPath } = await import('./can.svelte');
    as(['page:k3x9q2:view', 'pos:view']);
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(true);
    expect(canViewPath('/staff/sell~k3x9q2/t/1')).toBe(true);
    as(['pos:view']);
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(false);
    as(['page:k3x9q2:view']);
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(false);
  });

  test('floor lifts once the module is dataset-enforced', async () => {
    const { canViewPath } = await import('./can.svelte');
    enforced.list = ['pos'];
    as(['page:k3x9q2:view']);
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(true);
  });

  test("empty config: unknown path keeps today's open policy", async () => {
    const { canViewPath } = await import('./can.svelte');
    as(['page:k3x9q2:view']);
    pageData.navConfig = undefined;
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(true);
  });

  test('personal org hides a POS instance', async () => {
    const { canViewPath } = await import('./can.svelte');
    as(['page:k3x9q2:view', 'pos:view']);
    pageData.activeOrgKind = 'personal';
    expect(canViewPath('/staff/sell~k3x9q2')).toBe(false);
  });
});

// Spec 043: a page the org's plan lacks is not offered; flag off = full catalog = unchanged.
describe('canViewPath + hasFeature — plan features', () => {
  const premium = { plan: 'premium', features: ['ai', 'ai.chat', 'ai.proactive', 'marketplace'] };
  test('Base hides AI pages, archetype filters and nav instances targeting them', async () => {
    const { canViewPath } = await import('./can.svelte');
    pageData.user = { role: 'admin' };
    pageData.permissions = {
      permissions: [
        'reliability:view',
        'reliability.dashboard:view',
        'marketplace:view',
        'marketplace.dashboard:view',
        'agents:view',
        'brains:view',
      ],
    };
    const paths = [
      '/reliability',
      '/marketplace',
      '/agents?archetype=copilot',
      '/es/brains',
      '/overview',
    ];
    const today = paths.map(canViewPath);
    expect(today).toEqual([true, true, true, true, true]);
    pageData.entitlements = premium;
    expect(paths.map(canViewPath)).toEqual(today);
    pageData.entitlements = { plan: 'base', features: [] };
    expect(paths.map(canViewPath)).toEqual([false, false, false, false, true]);
    pageData.navConfig = {
      version: 1,
      sections: [
        {
          id: 's1',
          slug: 'ai',
          label: 'AI',
          pages: [{ id: 'q1w2e3', slug: 'b', label: 'B', kind: 'link', target: '/brains' }],
        },
      ],
      builtinSections: {},
      builtin: {},
    };
    pageData.permissions = { permissions: ['page:q1w2e3:view', 'brains:view'] };
    expect(canViewPath('/ai/b~q1w2e3')).toBe(false);
    pageData.entitlements = premium;
    expect(canViewPath('/ai/b~q1w2e3')).toBe(true);
  });
  test('hasFeature is exact membership; no entitlements in page.data = entitled', async () => {
    const { hasFeature } = await import('./can.svelte');
    expect(hasFeature('ai')).toBe(true);
    pageData.entitlements = { plan: 'base', features: ['ai'] };
    expect(hasFeature('ai')).toBe(true);
    expect(hasFeature('ai.chat')).toBe(false);
    expect(hasFeature('a')).toBe(false);
    pageData.entitlements = { plan: 'base', features: [] };
    expect(hasFeature('ai')).toBe(false);
  });
});
