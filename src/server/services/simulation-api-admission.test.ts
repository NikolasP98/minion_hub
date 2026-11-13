import { describe, expect, it } from 'vitest';
import { apiReadCapability, apiWriteCapability, buildCapabilities } from './rbac.service';
describe('simulation and contextual API capability seams', () => {
  it('gates contextual reads/writes with roles:edit independently of Team and Settings management', () => {
    const caps = buildCapabilities(
      ['custom-access'],
      [
        {
          role_key: 'custom-access',
          module: 'roles',
          can_view: true,
          can_create: false,
          can_edit: true,
          can_delete: false,
          can_export: false,
          can_manage: false,
        },
      ],
    );
    expect(caps.can('settings', 'manage')).toBe(false);
    expect(caps.can('users', 'manage')).toBe(false);
    const get = apiReadCapability('/api/nav/access'),
      put = apiWriteCapability('/api/nav/access', 'PUT');
    expect(get).toEqual({ module: 'roles', action: 'edit' });
    expect(put).toEqual(get);
    expect(caps.can(get!.module, get!.action)).toBe(true);
  });
  it.each(['users', 'settings', 'roles'] as const)(
    'does not allow contextual policy reads/writes from %s view or unrelated management',
    (module) => {
      const caps = buildCapabilities(
        ['custom-limited'],
        [
          {
            role_key: 'custom-limited',
            module,
            can_view: true,
            can_create: false,
            can_edit: false,
            can_delete: false,
            can_export: false,
            can_manage: module !== 'roles',
          },
        ],
      );
      for (const admission of [
        apiReadCapability('/api/nav/access'),
        apiWriteCapability('/api/nav/access', 'PUT'),
      ]) {
        expect(admission).toEqual({ module: 'roles', action: 'edit' });
        expect(caps.can(admission!.module, admission!.action)).toBe(false);
      }
    },
  );
  it('requires direct CRM/sales/support view even when no page navigation occurs', () => {
    for (const [path, module] of [
      ['/api/crm/contacts', 'crm'],
      ['/api/sales/orders', 'sales'],
      ['/api/support/issues', 'support'],
    ] as const)
      expect(apiReadCapability(path)).toEqual({ module, action: 'view' });
  });
  it('preserves anonymous booking, authenticated alias resolution and shared-party consumer alternatives', () => {
    expect(apiReadCapability('/api/scheduling/public/example/slots')).toBeNull();
    expect(apiReadCapability('/api/nav/resolve')).toBeNull();
    expect(apiReadCapability('/api/modules')).toBeNull();
    expect(apiReadCapability('/api/plugins/ui-list')).toBeNull();
    expect(apiReadCapability('/api/crm/parties')?.anyOf).toContainEqual({
      module: 'pos',
      action: 'view',
    });
    expect(apiWriteCapability('/api/crm/parties', 'POST')?.anyOf).toContainEqual({
      module: 'pos',
      action: 'create',
    });
  });
});
