import { describe, test, expect } from 'vitest';
import { can } from './policy';

const user = { role: 'user' as const };
const admin = { role: 'admin' as const };

describe('can()', () => {
  test('admin-min cap: user denied, admin allowed', () => {
    expect(can('users.manage', user)).toBe(false);
    expect(can('users.manage', admin)).toBe(true);
  });
  test('super-view cap: admin allowed, user denied', () => {
    expect(can('reliability.monitor', user)).toBe(false);
    expect(can('reliability.monitor', admin)).toBe(true);
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
