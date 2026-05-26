import { describe, test, expect } from 'vitest';
import { can } from './policy';

const user = { role: 'user' as const };
const admin = { role: 'admin' as const };
const sa = { role: 'super_admin' as const };

describe('can()', () => {
  test('admin-min cap: user denied, admin allowed, super allowed', () => {
    expect(can('users.manage', user)).toBe(false);
    expect(can('users.manage', admin)).toBe(true);
    expect(can('users.manage', sa)).toBe(true);
  });
  test('super-view cap: only super_admin', () => {
    expect(can('reliability.monitor', admin)).toBe(false);
    expect(can('reliability.monitor', sa)).toBe(true);
  });
  test('permission cap: granted via permission set', () => {
    expect(can('agents.publish', user, new Set(['marketplace:publish']))).toBe(true);
    expect(can('agents.publish', user, new Set())).toBe(false);
  });
  test('unknown key denies', () => {
    expect(can('nope', sa)).toBe(false);
  });
});
