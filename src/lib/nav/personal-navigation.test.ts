import { describe, it, expect } from 'vitest';
import {
  canUseFullNavigation,
  isPersonalNavigation,
  personalNavigation,
  orderPersonalSections,
} from './personal-navigation';
describe('personal navigation authority', () => {
  it('restricts the full navigation to the requested roles', () => {
    for (const role of ['owner', 'admin', 'manager'])
      expect(canUseFullNavigation([role])).toBe(true);
    for (const role of ['staff', 'viewer', 'user', 'unknown'])
      expect(canUseFullNavigation([role])).toBe(false);
    expect(canUseFullNavigation(undefined)).toBe(false);
    expect(canUseFullNavigation([])).toBe(false);
    expect(canUseFullNavigation([], 'admin')).toBe(true);
  });
  it('validates versioned bounded layouts and ignores another organization', () => {
    const v = {
      version: 1,
      organizationId: 'a',
      hidden: ['pos'],
      order: ['stock', 'custom:aaaaaa'],
    };
    expect(isPersonalNavigation(v)).toBe(true);
    expect(personalNavigation(v, 'b')).toEqual({
      version: 1,
      organizationId: 'b',
      hidden: [],
      order: [],
    });
    for (const patch of [
      { version: 2 },
      { order: ['x', 'x'] },
      { hidden: ['//evil'] },
      { hidden: Array(101).fill('x') },
      { extra: true },
    ])
      expect(isPersonalNavigation({ ...v, ...patch })).toBe(false);
  });
  it('drops stale catalog keys and appends new sections without granting access', () => {
    const catalog = [{ id: 'pos' }, { id: 'stock' }, { id: 'new' }];
    const v = personalNavigation(
      { version: 1, organizationId: 'a', hidden: ['missing'], order: ['missing', 'stock'] },
      'a',
    );
    expect(orderPersonalSections(catalog, v).map((s) => s.id)).toEqual(['stock', 'pos', 'new']);
  });
});
