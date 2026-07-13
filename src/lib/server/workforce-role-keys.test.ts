import { describe, expect, it } from 'vitest';
import { canonicalizeWorkforceRoleKeys, workforceIdentityCacheKey } from './workforce-role-keys';

describe('workforce identity role claims', () => {
  it('trims, deduplicates, sorts, and bounds signed role keys', () => {
    const roleKeys = canonicalizeWorkforceRoleKeys([
      ' staff ',
      'owner',
      'staff',
      '',
      null,
      'x'.repeat(129),
      ...Array.from({ length: 70 }, (_, index) => `custom-${String(index).padStart(2, '0')}`),
    ]);

    expect(roleKeys).toHaveLength(64);
    expect(roleKeys).toEqual([...roleKeys].sort());
    expect(canonicalizeWorkforceRoleKeys([' staff ', 'owner', 'staff'])).toEqual([
      'owner',
      'staff',
    ]);
    expect(roleKeys).not.toContain('x'.repeat(129));
  });

  it('uses the canonical role set in the token-cache key', () => {
    const first = workforceIdentityCacheKey({
      userId: 'user-1',
      companyId: 'company-1',
      roleKeys: ['staff', 'manager'],
    });
    const sameSet = workforceIdentityCacheKey({
      userId: 'user-1',
      companyId: 'company-1',
      roleKeys: [' manager ', 'staff', 'staff'],
    });
    const changedRole = workforceIdentityCacheKey({
      userId: 'user-1',
      companyId: 'company-1',
      roleKeys: ['staff'],
    });

    expect(sameSet).toBe(first);
    expect(changedRole).not.toBe(first);
  });
});
