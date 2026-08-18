import { describe, test, expect } from 'vitest';
import { maskPii, maskContactFields, sanitizeContactFields } from './pii';

describe('maskPii', () => {
  test('keeps last 4, masks the rest; short values fully masked', () => {
    expect(maskPii('923313093')).toBe('•••••3093');
    expect(maskPii('77479860')).toBe('••••9860');
    expect(maskPii('abc')).toBe('•••');
    expect(maskPii('')).toBe('');
    expect(maskPii(null)).toBe('');
  });
});

describe('maskContactFields', () => {
  test('redacts PII keys (phone/email/dni), leaves non-PII untouched', () => {
    const out = maskContactFields({
      telefono: '923313093',
      dni: '77479860',
      email: 'patient@example.com',
      edad: '34',
      distrito: 'Miraflores',
      _funnel: 'Customer', // reserved, not PII — untouched
    });
    expect(out.telefono).toBe('•••••3093');
    expect(out.dni).toBe('••••9860');
    expect(String(out.email)).toContain('•');
    expect(out.edad).toBe('34'); // non-PII untouched
    expect(out.distrito).toBe('Miraflores');
    expect(out._funnel).toBe('Customer');
  });
  test('null/empty fields pass through', () => {
    expect(maskContactFields(null)).toBe(null);
    expect(maskContactFields({ telefono: '' })).toEqual({ telefono: '' });
  });

  test('strips _relationship entirely for a masked principal (spec R6) — unlike _funnel', () => {
    const out = maskContactFields({
      _relationship: {
        label: 'mamá',
        category: 'family',
        source: 'ai',
        updatedAt: '2026-07-23T00:00:00Z',
      },
      _funnel: 'Customer',
      edad: '34',
    });
    expect('_relationship' in out).toBe(false);
    expect(out._funnel).toBe('Customer'); // _funnel is not PII — stays
    expect(out.edad).toBe('34');
  });

  test('strips _relationshipClaim (internal AI-inference lease lock) — never user-facing', () => {
    const out = maskContactFields({
      _relationshipClaim: { token: 't1', untilEpoch: 1234567890 },
      _funnel: 'Customer',
    });
    expect('_relationshipClaim' in out).toBe(false);
    expect(out._funnel).toBe('Customer');
  });
});

describe('sanitizeContactFields', () => {
  const fields = {
    telefono: '923313093',
    _relationship: {
      label: 'mamá',
      category: 'family',
      source: 'ai',
      updatedAt: '2026-07-23T00:00:00Z',
    },
    _relationshipClaim: { token: 't1', untilEpoch: 1234567890 },
    _funnel: 'Customer',
    distrito: 'Miraflores',
  };

  test('unmasked caller: keeps `_relationship` + PII, strips only `_relationshipClaim`', () => {
    const out = sanitizeContactFields(fields, false);
    expect(out._relationship).toEqual(fields._relationship);
    expect('_relationshipClaim' in out).toBe(false);
    expect(out.telefono).toBe('923313093'); // unmasked — no PII redaction
    expect(out._funnel).toBe('Customer');
  });

  test('masked caller: strips both `_relationship` and `_relationshipClaim`, redacts PII', () => {
    const out = sanitizeContactFields(fields, true);
    expect('_relationship' in out).toBe(false);
    expect('_relationshipClaim' in out).toBe(false);
    expect(out.telefono).toBe('•••••3093');
    expect(out._funnel).toBe('Customer');
  });

  test('unmasked caller, no claim present: returns the object unchanged (no allocation)', () => {
    const noClaim = { distrito: 'Miraflores' };
    expect(sanitizeContactFields(noClaim, false)).toBe(noClaim);
  });

  test('null/undefined pass through', () => {
    expect(sanitizeContactFields(null, false)).toBe(null);
    expect(sanitizeContactFields(undefined, true)).toBe(undefined);
  });
});
