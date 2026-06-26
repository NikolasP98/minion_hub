import { describe, test, expect, vi } from 'vitest';

vi.mock('$app/state', () => ({
  // Platform admins receive the full PERMISSIONS set (loadPermissionsForUser
  // short-circuit); users.manage + reliability.monitor are now permission-driven
  // (RBAC-migrated off minRole/super-view), so the perm set must carry them.
  page: {
    data: {
      user: { role: 'admin' },
      permissions: { permissions: ['marketplace:publish', 'users:manage', 'reliability:view'] },
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
