import { describe, it, expect } from 'vitest';
import {
  relationshipSchema,
  readRelationship,
  parseRelationshipValue,
  isRelationshipCategory,
  RELATIONSHIP_CATEGORIES,
} from './crm-relationship';
import { isReservedMetaKey } from './crm-meta';

describe('relationshipSchema', () => {
  it('parses/roundtrips a full valid blob', () => {
    const blob = {
      label: 'amiga del trabajo',
      category: 'work',
      source: 'ai',
      confidence: 0.83,
      inputSig: 'sig-1',
      inferenceVersion: 1,
      model: 'google/gemini-2.5-flash',
      updatedAt: '2026-07-23T00:00:00.000Z',
      evidenceRefs: [{ chunkId: 'c1', occurredAt: '2026-06-01' }],
    };
    const parsed = relationshipSchema.parse(blob);
    expect(parsed).toEqual(blob);
  });

  it('accepts label:null (user-cleared) and a minimal user blob', () => {
    const blob = { label: null, category: 'unknown', source: 'user', updatedAt: '2026-07-23T00:00:00Z' };
    expect(relationshipSchema.parse(blob)).toEqual(blob);
  });

  it('rejects an out-of-enum category', () => {
    const result = relationshipSchema.safeParse({
      label: 'x',
      category: 'partner', // v1 name — v2 uses romantic_partner (spec R2)
      source: 'ai',
      updatedAt: '2026-07-23T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    const result = relationshipSchema.safeParse({
      label: 'x',
      category: 'friend',
      source: 'ai',
      confidence: 1.5,
      updatedAt: '2026-07-23T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('readRelationship / parseRelationshipValue', () => {
  it('returns undefined for missing/invalid/malformed data', () => {
    expect(readRelationship(null)).toBeUndefined();
    expect(readRelationship({})).toBeUndefined();
    expect(readRelationship({ _relationship: 'not-an-object' })).toBeUndefined();
    expect(readRelationship({ _relationship: { category: 'friend' } })).toBeUndefined(); // missing source/updatedAt
    expect(parseRelationshipValue(undefined)).toBeUndefined();
  });

  it('reads a valid blob back out', () => {
    const value = { label: 'mamá', category: 'family', source: 'ai', updatedAt: '2026-07-23T00:00:00Z' };
    expect(readRelationship({ _relationship: value })).toEqual(value);
    expect(parseRelationshipValue(value)).toEqual(value);
  });
});

describe('isRelationshipCategory', () => {
  it('accepts every code-enum member, rejects free text', () => {
    for (const c of RELATIONSHIP_CATEGORIES) expect(isRelationshipCategory(c)).toBe(true);
    expect(isRelationshipCategory('bestie')).toBe(false);
    expect(isRelationshipCategory(42)).toBe(false);
  });
});

describe('reserved-key hygiene', () => {
  it('_relationship is hidden from the custom-fields editor like _funnel', () => {
    expect(isReservedMetaKey('_relationship')).toBe(true);
  });
});
