import { describe, expect, it } from 'vitest';
import { EMPTY_NAV_CONFIG, type NavConfig } from './custom-sections';
import {
  sectionAccessTargets,
  pageAccessTarget,
  inferMainPageAccessTarget,
} from './section-access-context';
const config: NavConfig = {
  ...EMPTY_NAV_CONFIG,
  sections: [
    {
      id: 'abc123',
      slug: 'team-work',
      label: 'Team work',
      pages: [
        {
          id: 'def456',
          kind: 'main',
          slug: 'customers',
          label: 'Customers',
          target: '/crm/customers',
        },
      ],
    },
  ],
};
describe('contextual section access targets', () => {
  it('uses functional native visibility for authenticated Home and Overview shells', () => {
    expect(inferMainPageAccessTarget('/home', EMPTY_NAV_CONFIG)).toBe('page:/home');
    expect(inferMainPageAccessTarget('/overview', EMPTY_NAV_CONFIG)).toBe('page:/overview');
    expect(
      sectionAccessTargets('organization', EMPTY_NAV_CONFIG, ['/home', '/overview']).map(
        (choice) => choice.target,
      ),
    ).toEqual(['page:/home', 'page:/overview']);
  });

  it('uses stable custom section and alias keys instead of labels', () => {
    expect(sectionAccessTargets('custom:abc123', config)).toEqual([
      { target: 'section:abc123', label: 'Team work' },
    ]);
    expect(pageAccessTarget('/team-work/customers~def456', config)).toBe('page:def456');
  });
  it('keeps a native page action distinct from its module data rules', () => {
    expect(pageAccessTarget('/es/crm/customers?search=x', EMPTY_NAV_CONFIG)).toBe(
      'page:/crm/customers',
    );
    expect(sectionAccessTargets('marketing', EMPTY_NAV_CONFIG).map((t) => t.target)).toEqual([
      'crm',
      'ads',
    ]);
  });
  it('infers only registered main nav screens and maps a moved main to its section', () => {
    expect(inferMainPageAccessTarget('/team-work/customers~def456', config)).toBe('section:abc123');
    expect(inferMainPageAccessTarget('/crm/customers', config)).toBe('section:abc123');
    expect(inferMainPageAccessTarget('/crm/customers', EMPTY_NAV_CONFIG)).toBe('crm');
    expect(inferMainPageAccessTarget('/crm/123', EMPTY_NAV_CONFIG)).toBeNull();
    expect(inferMainPageAccessTarget('/settings/roles', EMPTY_NAV_CONFIG)).toBeNull();
    expect(inferMainPageAccessTarget('/crm/customers/new', EMPTY_NAV_CONFIG)).toBeNull();
    expect(inferMainPageAccessTarget('/account/home', EMPTY_NAV_CONFIG)).toBeNull();
  });
});
