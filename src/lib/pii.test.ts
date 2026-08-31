import { describe, test, expect } from 'vitest';
import { maskPii, maskContactFields, sanitizeContactFields } from './pii';
import type { IcpResult } from './components/crm/crm-icp';

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

/**
 * ICP (spec 2026-08-03 §7). `_icp` is NOT dropped wholesale like
 * `_relationship`: `score`/`band` are derived aggregates of the same class as
 * the RFM `score` a masked principal already sees. The LLM-written free text
 * about private conversations is what must never survive — and the masking in
 * this module is SHALLOW, so these assertions are about the NESTED fields.
 */
const ICP_RESULT: IcpResult = {
  score: 82,
  band: 'strong',
  criteria: [{ id: 'budget', met: true, note: 'paid for two full plans up front' }],
  reasons: ['Bought a full plan twice', 'Never asks for a discount'],
  evidenceRefs: [{ chunkId: 'chunk-abc' }],
  inputSig: 'sig-1',
  icpVersion: 3,
  model: 'google/gemini-2.5-flash',
  promptVersion: 1,
  scoredAt: '2026-08-29T00:00:00.000Z',
};
const ICP_CLAIM = { token: 'lease-token', untilEpoch: 4102444800000 };

describe('maskContactFields — `_icp`', () => {
  test('keeps score/band but strips reasons, criteria notes and evidence refs', () => {
    const out = maskContactFields({ _icp: ICP_RESULT }) as Record<string, unknown>;
    const icp = out._icp as Record<string, unknown>;
    expect(icp.score).toBe(82);
    expect(icp.band).toBe('strong');
    expect(icp.criteria).toEqual([{ id: 'budget', met: true }]);
    expect('reasons' in icp).toBe(false);
    expect('evidenceRefs' in icp).toBe(false);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('paid for two full plans');
    expect(serialized).not.toContain('Bought a full plan twice');
    expect(serialized).not.toContain('chunk-abc');
  });

  test('drops a malformed `_icp` blob entirely rather than passing it through', () => {
    const out = maskContactFields({ _icp: 'she told me about her diagnosis' }) as Record<
      string,
      unknown
    >;
    expect('_icp' in out).toBe(false);
  });

  test('strips the `_icpClaim` lease', () => {
    const out = maskContactFields({ _icp: ICP_RESULT, _icpClaim: ICP_CLAIM }) as Record<
      string,
      unknown
    >;
    expect('_icpClaim' in out).toBe(false);
  });
});

describe('sanitizeContactFields — the ONE serialization gate', () => {
  test('strips BOTH inference leases for an UNMASKED principal, leaving everything else intact', () => {
    const out = sanitizeContactFields(
      {
        telefono: '923313093',
        _icp: ICP_RESULT,
        _icpClaim: ICP_CLAIM,
        _relationshipClaim: { token: 't', untilEpoch: 1 },
      },
      false,
    ) as Record<string, unknown>;
    expect('_icpClaim' in out).toBe(false);
    expect('_relationshipClaim' in out).toBe(false);
    // Unmasked: the verdict and the phone are untouched.
    expect(out._icp).toEqual(ICP_RESULT);
    expect(out.telefono).toBe('923313093');
  });

  test('strips `_icpClaim` even when it is the ONLY reserved lease present', () => {
    // Regression guard: the fast path used to short-circuit on
    // `_relationshipClaim` alone, which would have shipped the ICP lease.
    const out = sanitizeContactFields({ _icpClaim: ICP_CLAIM, edad: '34' }, false) as Record<
      string,
      unknown
    >;
    expect('_icpClaim' in out).toBe(false);
    expect(out.edad).toBe('34');
  });

  test('a masked principal gets no ICP free text and never the lease', () => {
    const out = sanitizeContactFields(
      { dni: '77479860', _icp: ICP_RESULT, _icpClaim: ICP_CLAIM },
      true,
    ) as Record<string, unknown>;
    expect('_icpClaim' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('chunk-abc');
    expect((out._icp as Record<string, unknown>).band).toBe('strong');
    expect(out.dni).toBe('••••9860');
  });

  test("does not mutate the caller's object", () => {
    const fields = { _icpClaim: ICP_CLAIM };
    sanitizeContactFields(fields, false);
    expect(fields._icpClaim).toEqual(ICP_CLAIM);
  });
});
