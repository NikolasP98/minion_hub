import { describe, expect, it } from 'vitest';
import { navigationProposal } from './navigation-proposal';

const pages = [{ path: '/pos/catalog', title: 'Catalog', description: '' }];
const allow = () => true;

describe('navigation proposals', () => {
  it('returns an inert canonical link and encodes query values', () => {
    const result = navigationProposal(
      { path: '/POS/CATALOG/', params: { q: '\"><script>&#?/', new: '1' } },
      pages,
      allow,
    );
    expect(result).toEqual({
      ok: true,
      navigated: false,
      requiresUserAction: true,
      path: '/pos/catalog',
      href: '/pos/catalog?q=%22%3E%3Cscript%3E%26%23%3F%2F&new=1',
      title: 'Catalog',
    });
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/pos/../catalog',
    '/pos/%2e%2e/catalog',
    '/pos/%252e%252e/catalog',
    '/pos/catalog?new=1',
    '/pos/catalog#x',
    '/pos/catalog\n',
    '/unknown',
    'javascript:alert(1)',
  ])('rejects unsafe or unknown path %s', (path) => {
    expect(navigationProposal({ path }, pages, allow)).toHaveProperty('error');
  });
  it.each([null, [], 'new=1', { q: 1 }, { q: {} }, new Date()])(
    'rejects non-string parameter records %j',
    (params) => {
      expect(navigationProposal({ path: '/pos/catalog', params }, pages, allow)).toHaveProperty(
        'error',
      );
    },
  );
  it('checks current permission, not only the previously visible page list', () => {
    expect(navigationProposal({ path: '/pos/catalog' }, pages, () => false)).toHaveProperty(
      'error',
    );
  });
});
