import { describe, expect, it } from 'vitest';
import {
  normalizeOrganizationName,
  organizationSlug,
  resolveOrgKind,
} from './organization-provision.service';

describe('organization provision input', () => {
  it('normalizes a stable display name and slug', () => {
    expect(normalizeOrganizationName('  PINONITE   CORP  ')).toBe('PINONITE CORP');
    expect(organizationSlug('Piñonite Corp.')).toBe('pinonite-corp');
  });

  it('rejects blank and non-addressable names', () => {
    expect(() => normalizeOrganizationName(' ')).toThrow('between 2 and 80');
    expect(() => organizationSlug('---')).toThrow('letters or numbers');
  });

  it('resolves the organization kind with a business default', () => {
    expect(resolveOrgKind(undefined)).toBe('business');
    expect(resolveOrgKind(null)).toBe('business');
    expect(resolveOrgKind('')).toBe('business');
    expect(resolveOrgKind('business')).toBe('business');
    expect(resolveOrgKind('personal')).toBe('personal');
  });

  it('rejects unknown organization kinds', () => {
    expect(() => resolveOrgKind('enterprise')).toThrow('must be one of');
    expect(() => resolveOrgKind(42)).toThrow('must be one of');
  });
});
