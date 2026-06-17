import { describe, it, expect } from 'vitest';
import { resolveEnabled } from './modules.service';

describe('resolveEnabled', () => {
  it('defaults to enabled when no row exists', () => {
    expect(resolveEnabled([], 'finances')).toBe(true);
  });
  it('honors an explicit disabled row', () => {
    expect(resolveEnabled([{ moduleId: 'finances', enabled: false }], 'finances')).toBe(false);
    expect(resolveEnabled([{ moduleId: 'crm', enabled: false }], 'finances')).toBe(true);
  });
});
