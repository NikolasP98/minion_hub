import { describe, expect, it } from 'vitest';
import { isSettingsDestination, SettingsReturnMemory } from './settings-layer';

describe('Settings route boundary', () => {
  it.each(['/settings', '/es/settings/plugins', '/en/settings?s=ai', '/settings/roles/one'])(
    'recognizes global Settings %s',
    (href) => expect(isSettingsDestination(href)).toBe(true),
  );
  it.each(['/settings-extra', '/pos/settings', '/finances/settings', '/es/crm/settings'])(
    'keeps module settings outside the layer: %s',
    (href) => expect(isSettingsDestination(href)).toBe(false),
  );
});

describe('Settings Back', () => {
  const origin = 'https://hub.test';
  const allow = () => true;
  it('restores the successful workspace location with locale, filters and fragment', () => {
    const memory = new SettingsReturnMemory();
    memory.observe(new URL('/es/crm/customers?status=active#selected', origin), 'actor:org', false);
    memory.observe(new URL('/es/settings/appearance', origin), 'actor:org', true);
    memory.observe(new URL('/es/settings?s=security', origin), 'actor:org', true);
    expect(memory.destination('actor:org', origin, allow)).toBe(
      '/es/crm/customers?status=active#selected',
    );
    // Reading a destination is not acknowledgement of a successful navigation.
    expect(memory.destination('actor:org', origin, allow)).toBe(
      '/es/crm/customers?status=active#selected',
    );
  });
  it('falls back on direct entry or a destination whose access was removed', () => {
    const memory = new SettingsReturnMemory();
    memory.observe(new URL('/settings/plugins', origin), 'actor:org', true);
    expect(memory.destination('actor:org', origin, allow)).toBe('/account/home');
    memory.observe(new URL('/stock/items', origin), 'actor:org', false);
    expect(memory.destination('actor:org', origin, () => false)).toBe('/account/home');
  });
  it('revalidates localized locations against canonical access after a grant is revoked', () => {
    const memory = new SettingsReturnMemory();
    memory.observe(new URL('/es/stock/items?sort=name#row', origin), 'actor:org', false);
    // The policy accepts only canonical paths. Localized unknown paths must not bypass it.
    const canView = (href: string) => href !== '/stock/items?sort=name';
    expect(memory.destination('actor:org', origin, canView)).toBe('/account/home');
  });
  it('retires the previous actor or organization rather than resurrecting its location', () => {
    const memory = new SettingsReturnMemory();
    memory.observe(new URL('/crm/customers?customer=private', origin), 'a:orgA', false);
    memory.reconcile('b:orgB');
    expect(memory.destination('b:orgB', origin, allow)).toBe('/account/home');
    memory.reconcile('a:orgA');
    expect(memory.destination('a:orgA', origin, allow)).toBe('/account/home');
  });
  it.each([
    '/settings/plugins',
    '/es/settings?s=ai',
    '/api/me',
    '/login',
    '/not-a-real-screen',
    '//other.test/crm',
  ])('does not return to an unsafe or non-workspace destination: %s', (href) => {
    const memory = new SettingsReturnMemory();
    memory.observe(new URL(href, origin), 'actor:org', false);
    expect(memory.destination('actor:org', origin, allow)).toBe('/account/home');
  });
});

describe('Settings offers leave native module settings intact', () => {
  it('resolves an existing Settings instance as part of the global layer', () => {
    const config = {
      version: 1 as const,
      builtin: {},
      builtinSections: {},
      sections: [
        {
          id: 'staff1',
          slug: 'staff',
          label: 'Staff',
          pages: [
            {
              id: 'set001',
              slug: 'prefs',
              label: 'Preferences',
              kind: 'link' as const,
              target: '/settings/appearance',
            },
          ],
        },
      ],
    };
    expect(isSettingsDestination('/es/staff/prefs~set001', config)).toBe(true);
    const memory = new SettingsReturnMemory();
    memory.observe(new URL('https://hub.test/es/staff/prefs~set001'), 'actor:org', false);
    expect(memory.destination('actor:org', 'https://hub.test', () => true, config)).toBe(
      '/account/home',
    );
  });
});
