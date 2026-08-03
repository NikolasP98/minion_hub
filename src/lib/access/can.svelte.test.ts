import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mutable so kind-gating tests below can flip `activeOrgKind` per test without
// re-mocking the module — `page.data` is read fresh at each canViewPath() call.
const pageData: {
  user: { role: 'user' | 'admin' };
  permissions: { permissions: string[] };
  activeOrgKind?: 'business' | 'personal' | null;
} = {
  // Platform admins receive the full PERMISSIONS set (loadPermissionsForUser
  // short-circuit); users.manage + reliability.monitor are now permission-driven
  // (RBAC-migrated off minRole/super-view), so the perm set must carry them.
  // For canViewPath we include finance:view but NOT finance.products:view so the
  // products subpage link hides while the section view stays.
  user: { role: 'admin' },
  permissions: {
    permissions: ['marketplace:publish', 'users:manage', 'reliability:view', 'finance:view'],
  },
  activeOrgKind: 'business',
};

vi.mock('$app/state', () => ({
  page: { data: pageData },
}));

beforeEach(() => {
  pageData.activeOrgKind = 'business';
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
    expect(canViewPath('/finances/products')).toBe(false); // finance.products:view absent
  });
});

// S3/WP1 (specs/2026-07-22-personal-org-differentiation-spec.md R2/R6):
// canViewPath additionally consults org-kind visibility so the command
// palette/hotkeys/SettingsNav stop offering kind-hidden modules.
describe('canViewPath — org-kind gating', () => {
  test('personal org: Team/Stock/POS/Workforce hidden even though RBAC would allow them', async () => {
    pageData.activeOrgKind = 'personal';
    pageData.permissions.permissions = [...pageData.permissions.permissions, 'stock:view', 'pos:view'];
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
    expect(canViewPath('/team')).toBe(true); // users:manage present
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
