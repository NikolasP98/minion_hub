import { describe, test, expect, vi } from 'vitest';

vi.mock('$app/state', () => ({
  // Platform admins receive the full PERMISSIONS set (loadPermissionsForUser
  // short-circuit); users.manage + reliability.monitor are now permission-driven
  // (RBAC-migrated off minRole/super-view), so the perm set must carry them.
  // For canViewPath we include finance:view but NOT finance.products:view so the
  // products subpage link hides while the section view stays.
  page: {
    data: {
      user: { role: 'admin' },
      permissions: {
        permissions: ['marketplace:publish', 'users:manage', 'reliability:view', 'finance:view'],
      },
    },
  },
}));

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
