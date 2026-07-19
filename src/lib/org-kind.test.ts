import { describe, test, expect } from 'vitest';
import { isModuleVisibleForKind } from './org-kind';

describe('isModuleVisibleForKind', () => {
  test('pulse hidden for business, visible for personal', () => {
    expect(isModuleVisibleForKind('pulse', 'business')).toBe(false);
    expect(isModuleVisibleForKind('pulse', 'personal')).toBe(true);
  });

  test('pos/stock/workforce hidden for personal, visible for business', () => {
    for (const moduleId of ['pos', 'stock', 'workforce']) {
      expect(isModuleVisibleForKind(moduleId, 'personal')).toBe(false);
      expect(isModuleVisibleForKind(moduleId, 'business')).toBe(true);
    }
  });

  test('unknown/undefined kind behaves as business', () => {
    expect(isModuleVisibleForKind('pulse', undefined)).toBe(false);
    expect(isModuleVisibleForKind('pulse', null)).toBe(false);
    expect(isModuleVisibleForKind('pos', undefined)).toBe(true);
  });

  test('unrelated module id is visible for both kinds', () => {
    expect(isModuleVisibleForKind('crm', 'business')).toBe(true);
    expect(isModuleVisibleForKind('crm', 'personal')).toBe(true);
  });
});
