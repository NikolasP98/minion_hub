import { describe, expect, it } from 'vitest';
import {
  validateCustomPropertyRules,
  validateCustomPropertyValue,
  type CustomPropertyRules,
} from './custom-properties';

const option = (id: string, label: string, archivedAt: string | null = null) => ({
  id,
  label,
  archivedAt,
  color: '#3b82f6' as const,
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('custom property contracts', () => {
  it('validates real Gregorian date-only values including years below 100', () => {
    const rules: CustomPropertyRules = { type: 'date', min: null, max: null };
    expect(validateCustomPropertyValue(rules, '0001-01-01').ok).toBe(true);
    expect(validateCustomPropertyValue(rules, '2024-02-29').ok).toBe(true);
    expect(validateCustomPropertyValue(rules, '2023-02-29')).toEqual({
      ok: false,
      code: 'invalid_date',
    });
    expect(validateCustomPropertyValue(rules, '0000-01-01')).toEqual({
      ok: false,
      code: 'invalid_date',
    });
  });

  it('enforces exact decimal precision without coercion', () => {
    const rules: CustomPropertyRules = { type: 'number', min: 0, max: 10, precision: 2 };
    expect(validateCustomPropertyValue(rules, 1.23).ok).toBe(true);
    expect(validateCustomPropertyValue(rules, 1.23).ok).toBe(true);
    expect(validateCustomPropertyValue(rules, 1.234)).toEqual({ ok: false, code: 'invalid_value' });
    expect(validateCustomPropertyValue(rules, Number.NaN)).toEqual({
      ok: false,
      code: 'invalid_value',
    });
  });

  it('allows archived options only when retained from the stored value', () => {
    const rules: CustomPropertyRules = {
      type: 'multi_select',
      options: [option(A, 'Old', '2026-01-01T00:00:00Z'), option(B, 'New')],
      maxSelections: null,
    };
    expect(validateCustomPropertyValue(rules, [A, B], new Set([A])).ok).toBe(true);
    expect(validateCustomPropertyValue(rules, [A], new Set())).toEqual({
      ok: false,
      code: 'archived_option',
    });
  });

  it('rejects duplicate active labels case-insensitively but permits archived history', () => {
    expect(
      validateCustomPropertyRules({
        type: 'select',
        options: [option(A, 'VIP'), option(B, 'vip')],
      }),
    ).toEqual({ ok: false, code: 'duplicate_option' });
    expect(
      validateCustomPropertyRules({
        type: 'select',
        options: [option(A, 'VIP', '2026-01-01T00:00:00Z'), option(B, 'vip')],
      }).ok,
    ).toBe(true);
  });

  it('rejects malformed and unknown rule objects without throwing', () => {
    expect(validateCustomPropertyRules({ type: 'select' })).toEqual({
      ok: false,
      code: 'invalid_rules',
    });
    expect(validateCustomPropertyRules({ type: 'boolean', surprise: true })).toEqual({
      ok: false,
      code: 'invalid_rules',
    });
    expect(validateCustomPropertyRules({ type: 'formula', expression: '1+1' })).toEqual({
      ok: false,
      code: 'invalid_rules',
    });
  });

  it('keeps null false zero and empty collections distinct', () => {
    expect(validateCustomPropertyValue({ type: 'boolean' }, false)).toEqual({
      ok: true,
      value: false,
    });
    expect(
      validateCustomPropertyValue({ type: 'number', min: null, max: null, precision: null }, 0),
    ).toEqual({ ok: true, value: 0 });
    expect(
      validateCustomPropertyValue({ type: 'multi_select', options: [], maxSelections: null }, []),
    ).toEqual({ ok: true, value: [] });
    expect(validateCustomPropertyValue({ type: 'text', maxLength: null }, null)).toEqual({
      ok: true,
      value: null,
    });
  });
});
