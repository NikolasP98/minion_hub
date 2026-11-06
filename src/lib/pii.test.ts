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
});

const NOW = '2026-11-06T10:00:00.000Z';
const validIcp = () => ({
  score: 72,
  band: 'moderate',
  criteria: [{ id: 'c1', met: true, note: 'NOTE-SECRET-text' }],
  reasons: ['REASON-SECRET-text'],
  evidenceRefs: [{ chunkId: 'chunk-SECRET-1' }],
  inputSig: 'sig-abc',
  icpVersion: 2,
  model: 'm',
  promptVersion: 1,
  scoredAt: NOW,
});
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('sanitizeContactFields — ICP keys', () => {
  test('unmasked: strips claims, keeps _icp deep-equal', () => {
    const input = deepFreeze({
      _icp: validIcp(),
      _icpClaim: { token: 't', exp: 1 },
      _relationshipClaim: { token: 't', exp: 1 },
      edad: '34',
    });
    const out = sanitizeContactFields(input, false);
    expect(out).not.toHaveProperty('_icpClaim');
    expect(out).not.toHaveProperty('_relationshipClaim');
    expect(out._icp).toEqual(validIcp());
    expect(out.edad).toBe('34');
  });

  test('unmasked: no claim keys returns the same reference', () => {
    const input = { _icp: validIcp(), edad: '34' };
    expect(sanitizeContactFields(input, false)).toBe(input);
  });

  test('masked: strips _icpClaim and projects _icp to the whitelist', () => {
    const input = deepFreeze({
      _icp: validIcp(),
      _icpClaim: { token: 't', exp: 1 },
      _relationship: { edges: ['x'] },
      telefono: '923313093',
    });
    const out = sanitizeContactFields(input, true);
    expect(out).not.toHaveProperty('_icpClaim');
    expect(out).not.toHaveProperty('_relationship');
    expect(out.telefono).toBe('•••••3093');
    expect(out._icp).toEqual({
      score: 72,
      band: 'moderate',
      criteria: [{ id: 'c1', met: true }],
      icpVersion: 2,
      scoredAt: NOW,
    });
    const json = JSON.stringify(out);
    for (const secret of ['REASON-SECRET', 'NOTE-SECRET', 'chunk-SECRET', 'sig-abc']) {
      expect(json).not.toContain(secret);
    }
  });

  test('masked: malformed _icp is removed entirely', () => {
    const out = maskContactFields(
      deepFreeze({ _icp: { score: 'high', reasons: ['secret'] }, edad: '34' }),
    );
    expect(out).not.toHaveProperty('_icp');
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out.edad).toBe('34');
  });

  test('masked: a free-text criteria[].id drops _icp (id is not a leak channel)', () => {
    const freeText = 'Patient said she was diagnosed with cancer; DNI 12345678';
    const icp = { ...validIcp(), criteria: [{ id: freeText, met: true, note: 'n' }] };
    const out = sanitizeContactFields(deepFreeze({ _icp: icp, edad: '34' }), true);
    expect(out).not.toHaveProperty('_icp');
    expect(JSON.stringify(out)).not.toContain('diagnosed');
    expect(out.edad).toBe('34');
  });

  test('neither mode mutates the input', () => {
    const make = () => ({
      _icp: validIcp(),
      _icpClaim: { token: 't', exp: 1 },
      _relationshipClaim: { token: 't', exp: 1 },
    });
    for (const masked of [false, true]) {
      const input = make();
      sanitizeContactFields(input, masked);
      expect(input).toEqual(make());
    }
  });
});
