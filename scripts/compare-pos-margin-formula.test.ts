import { describe, expect, it } from 'vitest';
import { parseOptions } from './compare-pos-margin-formula';

describe('POS margin formula comparison arguments', () => {
  it('requires every organization and actor guard', () => {
    expect(() => parseOptions([])).toThrow('--org-id is required');
    expect(() => parseOptions(['--org-id', 'org'])).toThrow('--expected-org-slug is required');
    expect(() => parseOptions(['--org-id', 'org', '--expected-org-slug', 'slug'])).toThrow(
      '--actor-profile-id is required',
    );
  });

  it('returns the explicit read-only target', () => {
    expect(
      parseOptions([
        '--org-id',
        'org',
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        'actor',
      ]),
    ).toEqual({ orgId: 'org', expectedOrgSlug: 'slug', actorProfileId: 'actor' });
  });
});
