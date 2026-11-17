import { describe, test, expect } from 'vitest';
import {
  maskPii,
  maskContactFields,
  omitManualInstagramFields,
  omitMaskedFields,
  sanitizeContactFields,
} from './pii';

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

describe('manual Instagram keys', () => {
  const fields = { Instagram: 'a_handle', instagram_handle: 'b', telefono: '1', distrito: 'x' };
  test('are masked keys, in any case', () => {
    const out = sanitizeContactFields({ INSTAGRAM_HANDLE: 'synthetic_123', distrito: 'x' }, true);
    expect(out.INSTAGRAM_HANDLE).toBe('••••••••_123');
    expect(out.distrito).toBe('x');
  });
  test('omitManualInstagramFields drops exactly the two keys', () => {
    expect(omitManualInstagramFields(fields)).toEqual({ telefono: '1', distrito: 'x' });
  });
  test('omitMaskedFields drops every masked key and keeps the rest', () => {
    expect(omitMaskedFields(fields)).toEqual({ distrito: 'x' });
  });
});
