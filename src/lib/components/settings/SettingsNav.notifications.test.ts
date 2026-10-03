// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
const context = vi.hoisted(() => ({
  admin: { value: false },
  page: {
    url: new URL('http://localhost/settings/notifications'),
    data: {
      user: { role: 'user' },
      permissions: { permissions: [] as string[] },
      activeOrgKind: 'business',
    },
  },
}));
vi.mock('$app/state', () => ({ page: context.page }));
vi.mock('$lib/state/features/user.svelte', () => ({ isAdmin: context.admin }));
import SettingsNav from './SettingsNav.svelte';
import { canAccessRoute } from '$lib/routes/route-access-policies';

afterEach(cleanup);
beforeEach(() => {
  context.admin.value = false;
  context.page.data.user.role = 'user';
  context.page.data.permissions.permissions = [];
});

describe('notification settings use the same capability in route and actual navigation', () => {
  it('offers organization managers the actual settings link without a global-admin role', () => {
    context.page.data.permissions.permissions = ['comms:manage'];
    const view = render(SettingsNav);
    expect(view.getByRole('link', { name: 'Notifications' }).getAttribute('href')).toBe(
      '/settings/notifications',
    );
    expect(
      canAccessRoute('/settings/notifications', {
        authenticated: true,
        role: 'user',
        permissions: new Set(['comms:manage']),
      }),
    ).toBe(true);
  });
  it.each([['comms:view'], ['comms:create'], []])(
    'does not offer management with only %j',
    (...permissions) => {
      context.page.data.permissions.permissions = permissions;
      const view = render(SettingsNav);
      expect(view.queryByRole('link', { name: 'Notifications' })).toBeNull();
      expect(
        canAccessRoute('/settings/notifications', {
          authenticated: true,
          role: 'user',
          permissions: new Set(permissions),
        }),
      ).toBe(false);
    },
  );
  it('does not let a cached administrator role substitute for the route capability', () => {
    context.admin.value = true;
    context.page.data.user.role = 'admin';
    const view = render(SettingsNav);
    expect(view.queryByRole('link', { name: 'Notifications' })).toBeNull();
    expect(
      canAccessRoute('/settings/notifications', {
        authenticated: true,
        role: 'admin',
        permissions: new Set(),
      }),
    ).toBe(false);
  });
});
