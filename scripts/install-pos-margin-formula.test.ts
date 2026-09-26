import { describe, expect, it } from 'vitest';
import { parseOptions } from './install-pos-margin-formula';

describe('POS margin formula installer arguments', () => {
  it('is dry-run by default and uses the stable default label', () => {
    expect(
      parseOptions([
        '--org-id',
        'org',
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        'actor',
      ]),
    ).toEqual({
      orgId: 'org',
      expectedOrgSlug: 'slug',
      actorProfileId: 'actor',
      label: 'Margin (formula)',
      apply: false,
    });
  });

  it('requires every targeting guard and accepts an explicit localized label', () => {
    expect(() => parseOptions([])).toThrow('--org-id is required');
    expect(
      parseOptions([
        '--org-id',
        'org',
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        'actor',
        '--label',
        'Margen (fórmula)',
        '--apply',
      ]),
    ).toMatchObject({ label: 'Margen (fórmula)', apply: true });
  });
});
