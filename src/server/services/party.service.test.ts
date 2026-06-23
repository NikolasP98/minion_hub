import { describe, it, expect } from 'vitest';
import { phone9 } from './party.service';

describe('phone9', () => {
  it('keeps the last 9 digits, stripping non-digits and country code', () => {
    expect(phone9('+51 992 376 833')).toBe('992376833');
    expect(phone9('51992376833')).toBe('992376833');
    expect(phone9('992376833')).toBe('992376833');
  });

  it('returns null for too-short or empty input', () => {
    expect(phone9('1234567')).toBeNull(); // 7 digits
    expect(phone9('')).toBeNull();
    expect(phone9(null)).toBeNull();
    expect(phone9(undefined)).toBeNull();
  });

  it('matches the two facets that should dedup to one party', () => {
    // CRM identity (WhatsApp jid) and finance client phone → same key.
    expect(phone9('51992376833@s.whatsapp.net')).toBe(phone9('992376833'));
  });
});
