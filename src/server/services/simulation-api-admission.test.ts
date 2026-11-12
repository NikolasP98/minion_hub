import { describe, expect, it } from 'vitest';
import { apiReadCapability, apiWriteCapability, buildCapabilities } from './rbac.service';
describe('simulation and contextual API capability seams', () => {
  it('gates contextual reads/writes with users:manage independently of settings:manage', () => {
    const caps = buildCapabilities(
      ['custom-access'],
      [
        {
          role_key: 'custom-access',
          module: 'users',
          can_view: true,
          can_create: false,
          can_edit: false,
          can_delete: false,
          can_export: false,
          can_manage: true,
        },
      ],
    );
    expect(caps.can('settings', 'manage')).toBe(false);
    const get = apiReadCapability('/api/nav/access'),
      put = apiWriteCapability('/api/nav/access', 'PUT');
    expect(get).toEqual({ module: 'users', action: 'manage' });
    expect(put).toEqual(get);
    expect(caps.can(get!.module, get!.action)).toBe(true);
  });
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
