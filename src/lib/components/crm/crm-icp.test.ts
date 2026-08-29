import { describe, it, expect } from 'vitest';
import {
  ICP_CLAIM_KEY,
  ICP_CRITERIA_MAX,
  ICP_DISQUALIFIED_SCORE_MAX,
  ICP_DISQUALIFIERS_MAX,
  ICP_KEY,
  ICP_NOTE_MAX,
  ICP_REASONS_MAX,
  icpBandForScore,
  icpDefinitionSchema,
  icpDefinitionWriteSchema,
  icpResultSchema,
  icpVerdict,
  isIcpConfigured,
  maskIcpResult,
  parseIcpResult,
  readIcpResult,
  type IcpResult,
} from './crm-icp';
import { isReservedMetaKey } from './crm-meta';

/**
 * The ICP contract (spec 2026-08-03-crm-icp-score-spec, S1). Everything here is
 * pure, so each rule is asserted on its own rather than through one happy-path
 * fixture — these bounds are what stop an org-authored definition from growing
 * the judge prompt without limit and what stop LLM free text from reaching a
 * masked principal.
 */

const criterion = (id: string, weight = 3) => ({ id, label: `Has ${id}`, weight });

const validDefinition = {
  description: 'Clinics in Lima with budget for a full treatment plan.',
  criteria: [criterion('budget'), criterion('lima', 5)],
  disqualifiers: ['only ever asks for free consults'],
};

const validResult: IcpResult = {
  score: 82,
  band: 'strong',
  criteria: [{ id: 'budget', met: true, note: 'paid two full plans' }],
  reasons: ['Bought a full plan twice', 'Books without discount pressure'],
  evidenceRefs: [{ chunkId: 'chunk-1' }],
  inputSig: 'sig-1',
  icpVersion: 3,
  model: 'google/gemini-2.5-flash',
  promptVersion: 1,
  scoredAt: '2026-08-29T00:00:00.000Z',
};

describe('reserved keys', () => {
  it('are `_`-prefixed, so the existing reserved-key machinery already hides and protects them', () => {
    // `isReservedMetaKey` drives BOTH the meta-column editor's hidden list and
    // `customFieldsMergeSql`'s "a client PATCH may not forge this" filter — the
    // ICP keys inherit both by naming alone, with no extra list to keep in sync.
    expect(isReservedMetaKey(ICP_KEY)).toBe(true);
    expect(isReservedMetaKey(ICP_CLAIM_KEY)).toBe(true);
  });
});

describe('icpBandForScore / icpVerdict — band thresholds', () => {
  it.each([
    [100, 'strong'],
    [75, 'strong'],
    [74, 'moderate'],
    [50, 'moderate'],
    [49, 'weak'],
    [0, 'weak'],
  ])('score %i ⇒ %s', (score, band) => {
    expect(icpBandForScore(score)).toBe(band);
    expect(icpVerdict({ score })).toEqual({ score, band });
  });

  it('bands at the SAME breakpoints as the RFM ramp, so two adjacent columns cannot disagree', () => {
    // 75/50 are `scoreColor`/`temperatureOf`'s breakpoints in crm-format.ts.
    expect(icpBandForScore(75)).toBe('strong');
    expect(icpBandForScore(50)).toBe('moderate');
  });

  it('rounds and clamps a raw model score into range instead of storing it out of bounds', () => {
    expect(icpVerdict({ score: 74.6 })).toEqual({ score: 75, band: 'strong' });
    expect(icpVerdict({ score: 140 })).toEqual({ score: 100, band: 'strong' });
    expect(icpVerdict({ score: -20 })).toEqual({ score: 0, band: 'weak' });
    expect(icpVerdict({ score: Number.NaN })).toEqual({ score: 0, band: 'weak' });
  });
});

describe('icpVerdict — disqualifier short-circuit', () => {
  it('clamps the score AND sets the band together, so a high model score cannot survive a match', () => {
    expect(icpVerdict({ score: 92, disqualified: true })).toEqual({
      score: ICP_DISQUALIFIED_SCORE_MAX,
      band: 'disqualified',
    });
  });

  it('does not PROMOTE an already-low disqualified score up to the cap', () => {
    expect(icpVerdict({ score: 3, disqualified: true })).toEqual({
      score: 3,
      band: 'disqualified',
    });
  });

  it('`disqualified: false` is not a short-circuit — normal banding applies', () => {
    expect(icpVerdict({ score: 92, disqualified: false })).toEqual({ score: 92, band: 'strong' });
  });
});

describe('icpDefinitionWriteSchema — the WRITE boundary (strict, rejects instead of clamping)', () => {
  it('accepts a well-formed definition', () => {
    expect(icpDefinitionWriteSchema.safeParse(validDefinition).success).toBe(true);
  });

  it('accepts an EMPTY definition — that is how an org turns the feature back off', () => {
    const parsed = icpDefinitionWriteSchema.safeParse({
      description: '',
      criteria: [],
      disqualifiers: [],
    });
    expect(parsed.success).toBe(true);
    // …and an empty definition reads as unconfigured, so no column/tick/LLM spend.
    expect(isIcpConfigured({ ...parsed.data!, version: 4, updatedAt: 'now' })).toBe(false);
  });

  it(`rejects more than ${ICP_CRITERIA_MAX} criteria rather than silently truncating`, () => {
    const tooMany = Array.from({ length: ICP_CRITERIA_MAX + 1 }, (_, i) => criterion(`c${i}`));
    expect(
      icpDefinitionWriteSchema.safeParse({ ...validDefinition, criteria: tooMany }).success,
    ).toBe(false);
    const atCap = tooMany.slice(0, ICP_CRITERIA_MAX);
    expect(
      icpDefinitionWriteSchema.safeParse({ ...validDefinition, criteria: atCap }).success,
    ).toBe(true);
  });

  it(`rejects more than ${ICP_DISQUALIFIERS_MAX} disqualifiers`, () => {
    const tooMany = Array.from({ length: ICP_DISQUALIFIERS_MAX + 1 }, (_, i) => `no ${i}`);
    expect(
      icpDefinitionWriteSchema.safeParse({ ...validDefinition, disqualifiers: tooMany }).success,
    ).toBe(false);
  });

  it('rejects a weight outside 1..5 and a fractional weight', () => {
    for (const weight of [0, 6, 2.5]) {
      expect(
        icpDefinitionWriteSchema.safeParse({
          ...validDefinition,
          criteria: [criterion('budget', weight)],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects duplicate criterion ids — they are the join key to each verdict', () => {
    expect(
      icpDefinitionWriteSchema.safeParse({
        ...validDefinition,
        criteria: [criterion('budget'), criterion('budget', 4)],
      }).success,
    ).toBe(false);
  });

  it('rejects a criterion id that is not a stable slug', () => {
    for (const id of ['Budget', 'has budget', '-budget', '']) {
      expect(
        icpDefinitionWriteSchema.safeParse({ ...validDefinition, criteria: [criterion(id)] })
          .success,
      ).toBe(false);
    }
  });

  it('rejects an over-long description and an empty/over-long criterion label', () => {
    expect(
      icpDefinitionWriteSchema.safeParse({ ...validDefinition, description: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      icpDefinitionWriteSchema.safeParse({
        ...validDefinition,
        criteria: [{ id: 'budget', label: '', weight: 3 }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys and refuses a client-supplied `version`/`updatedAt`', () => {
    expect(icpDefinitionWriteSchema.safeParse({ ...validDefinition, surprise: 1 }).success).toBe(
      false,
    );
    // A client-chosen version could re-use one already scored against, which
    // would leave every affected contact holding a stale verdict forever.
    expect(icpDefinitionWriteSchema.safeParse({ ...validDefinition, version: 99 }).success).toBe(
      false,
    );
    expect(
      icpDefinitionWriteSchema.safeParse({ ...validDefinition, updatedAt: '2026-08-29' }).success,
    ).toBe(false);
  });
});

describe('icpDefinitionSchema — the STORED shape', () => {
  it('requires the server-owned bookkeeping the write schema forbids', () => {
    expect(icpDefinitionSchema.safeParse(validDefinition).success).toBe(false);
    expect(
      icpDefinitionSchema.safeParse({ ...validDefinition, version: 1, updatedAt: 'now' }).success,
    ).toBe(true);
  });

  it('rejects version 0 / a fractional version — versions only move forward', () => {
    for (const version of [0, -1, 1.5]) {
      expect(
        icpDefinitionSchema.safeParse({ ...validDefinition, version, updatedAt: 'now' }).success,
      ).toBe(false);
    }
  });
});

describe('isIcpConfigured — the "feature is OFF" gate', () => {
  const stored = { ...validDefinition, version: 1, updatedAt: 'now' };
  it('is false for null/undefined', () => {
    expect(isIcpConfigured(null)).toBe(false);
    expect(isIcpConfigured(undefined)).toBe(false);
  });
  it('is true with a description alone, or with criteria alone', () => {
    expect(isIcpConfigured({ ...stored, criteria: [] })).toBe(true);
    expect(isIcpConfigured({ ...stored, description: '   ' })).toBe(true);
  });
  it('is false when only disqualifiers are set — nothing to score positively against', () => {
    expect(
      isIcpConfigured({ ...stored, description: '  ', criteria: [], disqualifiers: ['freebies'] }),
    ).toBe(false);
  });
});

describe('icpResultSchema — the stored `_icp` blob', () => {
  it('accepts a well-formed verdict and round-trips through parse/read helpers', () => {
    expect(icpResultSchema.safeParse(validResult).success).toBe(true);
    expect(parseIcpResult(validResult)).toEqual(validResult);
    expect(readIcpResult({ [ICP_KEY]: validResult })).toEqual(validResult);
  });

  it('rejects an out-of-range score', () => {
    expect(icpResultSchema.safeParse({ ...validResult, score: 101 }).success).toBe(false);
    expect(icpResultSchema.safeParse({ ...validResult, score: -1 }).success).toBe(false);
  });

  it('rejects an unknown band', () => {
    expect(icpResultSchema.safeParse({ ...validResult, band: 'excellent' }).success).toBe(false);
  });

  it(`rejects more than ${ICP_CRITERIA_MAX} criteria`, () => {
    const tooMany = Array.from({ length: ICP_CRITERIA_MAX + 1 }, (_, i) => ({
      id: `c${i}`,
      met: true,
      note: '',
    }));
    expect(icpResultSchema.safeParse({ ...validResult, criteria: tooMany }).success).toBe(false);
  });

  it(`rejects a note longer than ${ICP_NOTE_MAX} chars and a reason longer than 200`, () => {
    expect(
      icpResultSchema.safeParse({
        ...validResult,
        criteria: [{ id: 'budget', met: true, note: 'x'.repeat(ICP_NOTE_MAX + 1) }],
      }).success,
    ).toBe(false);
    expect(icpResultSchema.safeParse({ ...validResult, reasons: ['x'.repeat(201)] }).success).toBe(
      false,
    );
  });

  it(`rejects more than ${ICP_REASONS_MAX} reasons`, () => {
    const tooMany = Array.from({ length: ICP_REASONS_MAX + 1 }, (_, i) => `reason ${i}`);
    expect(icpResultSchema.safeParse({ ...validResult, reasons: tooMany }).success).toBe(false);
  });

  it('rejects raw evidence TEXT smuggled alongside the refs (strict object, refs only)', () => {
    expect(
      icpResultSchema.safeParse({
        ...validResult,
        evidenceRefs: [{ chunkId: 'chunk-1', text: 'me duele mucho, necesito ayuda' }],
      }).success,
    ).toBe(false);
  });

  it('parse/read helpers return undefined for an absent or malformed blob', () => {
    expect(parseIcpResult(undefined)).toBeUndefined();
    expect(parseIcpResult({ score: 'high' })).toBeUndefined();
    expect(readIcpResult(null)).toBeUndefined();
    expect(readIcpResult({ other: 1 })).toBeUndefined();
  });
});

describe('maskIcpResult — free text never reaches a masked principal', () => {
  it('keeps score/band/bookkeeping and drops reasons, per-criterion notes and evidence refs', () => {
    const masked = maskIcpResult(validResult);
    expect(masked).toEqual({
      score: 82,
      band: 'strong',
      criteria: [{ id: 'budget', met: true }],
      inputSig: 'sig-1',
      icpVersion: 3,
      model: 'google/gemini-2.5-flash',
      promptVersion: 1,
      scoredAt: '2026-08-29T00:00:00.000Z',
    });
    // Nothing the judge wrote about the conversation survives, at any depth.
    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain('paid two full plans');
    expect(serialized).not.toContain('Bought a full plan twice');
    expect(serialized).not.toContain('chunk-1');
  });

  it('is a WHITELIST — a future/unknown free-text field is dropped, not passed through', () => {
    const masked = maskIcpResult({
      ...validResult,
      summary: 'patient disclosed a diagnosis in chat',
    }) as Record<string, unknown>;
    expect('summary' in masked).toBe(false);
  });

  it('drops a value of the wrong type instead of copying free text through `score`/`band`', () => {
    const masked = maskIcpResult({
      score: 'they mentioned their surgery',
      band: 'notaband',
      criteria: [{ id: 'budget', met: 'yes', note: 'leak' }],
    }) as Record<string, unknown>;
    expect(masked).toEqual({ criteria: [] });
  });

  it('drops a non-object blob entirely', () => {
    expect(maskIcpResult('free text that got stored here somehow')).toBeUndefined();
    expect(maskIcpResult(null)).toBeUndefined();
    expect(maskIcpResult([validResult])).toBeUndefined();
  });
});
