import { describe, test, expect } from 'vitest';
import { can } from './policy';

const user = { role: 'user' as const };
const admin = { role: 'admin' as const };

describe('can()', () => {
  test('super-view cap (minRole): admin allowed, user denied', () => {
    // Cloud workspaces are org-RBAC-driven rather than a platform-admin super-view.
    expect(can('workspace.view', user, new Set())).toBe(false);
    expect(can('workspace.view', user, new Set(['workspace:view']))).toBe(true);
    expect(can('workspace.view', admin, new Set(['workspace:view']))).toBe(true);
  });
  test('users.manage migrated to RBAC permission (not minRole)', () => {
    // Pure can() is permission-driven now; platform admins pass in practice via
    // the all-PERMISSIONS short-circuit that seeds their perm set.
    expect(can('users.manage', user, new Set())).toBe(false);
    expect(can('users.manage', admin, new Set())).toBe(false);
    expect(can('users.manage', user, new Set(['users:manage']))).toBe(true);
  });
  test('reliability.monitor migrated to RBAC permission (was super-view)', () => {
    expect(can('reliability.monitor', admin, new Set())).toBe(false);
    expect(can('reliability.monitor', user, new Set(['reliability:view']))).toBe(true);
  });
  test('permission cap: granted via permission set', () => {
    expect(can('agents.publish', user, new Set(['marketplace:publish']))).toBe(true);
    expect(can('agents.publish', user, new Set())).toBe(false);
  });
  test('unknown key denies', () => {
    expect(can('nope', admin)).toBe(false);
  });
  test('null/undefined user treated as anonymous (user rank)', () => {
    expect(can('users.manage', null)).toBe(false);
    expect(can('users.manage', undefined)).toBe(false);
  });
});
