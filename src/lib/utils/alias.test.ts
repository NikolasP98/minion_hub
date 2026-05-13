import { describe, it, expect } from 'vitest';
import { validateAlias, normalizeAlias } from './alias';

describe('validateAlias', () => {
  it('accepts lowercase alphanumeric + underscore, 2-32 chars', () => {
    expect(validateAlias('nikolas')).toEqual({ ok: true });
    expect(validateAlias('a_b_c_2')).toEqual({ ok: true });
    expect(validateAlias('ab')).toEqual({ ok: true });
    expect(validateAlias('a'.repeat(32))).toEqual({ ok: true });
  });

  it('rejects too short, too long, bad chars, empty', () => {
    expect(validateAlias('a')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateAlias('a'.repeat(33))).toEqual({ ok: false, reason: 'invalid' });
    expect(validateAlias('Nikolas')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateAlias('niko las')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateAlias('niko-las')).toEqual({ ok: false, reason: 'invalid' });
    expect(validateAlias('')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('normalizeAlias', () => {
  it('lowercases and trims', () => {
    expect(normalizeAlias('  Nikolas  ')).toBe('nikolas');
  });
  it('returns null for empty', () => {
    expect(normalizeAlias('')).toBeNull();
    expect(normalizeAlias('   ')).toBeNull();
  });
});
