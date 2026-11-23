import { describe, expect, it, vi } from 'vitest';
import fixtures from './branding-fixtures.json';
import { validateHubName, suggestHubName, resolveBranding, hubNameLength } from './branding';
describe('shared Hub name contract', () => {
  it.each(fixtures)('validates $input', ({ input, valid, normalized }) => {
    const result = validateHubName(input);
    expect(result.ok).toBe(valid);
    if (result.ok) expect(result.value).toBe(normalized ?? input);
  });
  it('counts graphemes and rejects raw controls, disallowed selectors and format emoji', () => {
    expect(hubNameLength('👩‍👩‍👧‍👦é')).toBe(2);
    for (const text of [
      'a\u0085',
      'a\u2028',
      'a\u2029',
      'a\uFE00',
      'a\u{E0100}',
      '🏴\u{E0067}\u{E007F}',
    ])
      expect(validateHubName(text).ok).toBe(false);
    expect(validateHubName('🇵🇪').ok).toBe(true);
  });
  it('accepts the exact UTF-8 byte bound independently of grapheme count', () => {
    const maximum = 'é' + '\u0301'.repeat(127);
    expect(new TextEncoder().encode(maximum).length).toBe(256);
    expect(validateHubName(maximum).ok).toBe(true);
    expect(validateHubName(maximum + '\u0301').ok).toBe(false);
  });
  it('distinguishes explicit MINION, invalid override, automatic suffix and fallback', () => {
    expect(resolveBranding({ id: 'a', name: 'Faces Hub' })).toMatchObject({
      name: 'Faces',
      source: 'organization',
    });
    expect(resolveBranding({ id: 'a', name: 'Faces', hub_name: 'MINION' })).toMatchObject({
      name: 'MINION',
      source: 'custom',
    });
    expect(resolveBranding({ id: 'a', name: 'Faces', hub_name: 'invalid Hub' })).toMatchObject({
      name: 'Faces',
      source: 'organization',
    });
    expect(suggestHubName('Faces Hub Hub')).toBeNull();
    expect(resolveBranding({ id: 'a', name: 'Very long organization name' })).toMatchObject({
      name: 'MINION',
      source: 'default',
    });
    expect(resolveBranding({ id: 'b', name: 'Faces' }, 'unavailable')).toMatchObject({
      orgId: 'b',
      name: 'MINION',
      readStatus: 'unavailable',
    });
  });
  it('fails closed without a supported segmenter', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    try {
      expect(validateHubName('Faces')).toEqual({ ok: false, code: 'unavailable' });
      expect(resolveBranding({ id: 'a', name: 'Faces' }).readStatus).toBe('unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
