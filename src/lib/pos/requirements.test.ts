import { describe, it, expect } from 'vitest';
import { missingRequirements, normalizeRequirements } from './requirements';

describe('requirements registry', () => {
  it('normalizes an empty / legacy / bad row to off for every kind', () => {
    expect(normalizeRequirements(null)).toEqual({ identityDocument: 'off', phone: 'off' });
    expect(normalizeRequirements({ identityDocument: 'required' })).toEqual({
      identityDocument: 'required',
      phone: 'off',
    });
    expect(normalizeRequirements({ phone: 'mandatory' })).toEqual({
      identityDocument: 'off',
      phone: 'off',
    });
  });

  it('reports only the required kinds the customer lacks, in registry order', () => {
    const req = { identityDocument: 'required', phone: 'required' } as const;
    expect(missingRequirements(req, { docNumber: null, phone: null })).toEqual([
      'identityDocument',
      'phone',
    ]);
    expect(missingRequirements(req, { docNumber: '12345678', phone: null })).toEqual(['phone']);
    expect(missingRequirements(req, { docNumber: '12345678', phone: '987654321' })).toEqual([]);
    expect(missingRequirements({ phone: 'optional' }, { phone: null })).toEqual([]);
    expect(missingRequirements(undefined, {})).toEqual([]);
  });
});
