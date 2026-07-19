import { describe, expect, it } from 'vitest';
import { normalizeOrganizationName, organizationSlug } from './organization-provision.service';

describe('organization provision input', () => {
  it('normalizes a stable display name and slug', () => {
    expect(normalizeOrganizationName('  PINONITE   CORP  ')).toBe('PINONITE CORP');
    expect(organizationSlug('Piñonite Corp.')).toBe('pinonite-corp');
  });

  it('rejects blank and non-addressable names', () => {
    expect(() => normalizeOrganizationName(' ')).toThrow('between 2 and 80');
    expect(() => organizationSlug('---')).toThrow('letters or numbers');
  });
});
