import { describe, expect, it } from 'vitest';
import { configSchema, defaultConfig, whatsappDigits } from './offer';

const ID = '11111111-2222-4333-8444-555555555555';

describe('offer door config', () => {
  it('accepts the default config', () => {
    expect(configSchema.safeParse(defaultConfig).success).toBe(true);
  });
  it('rejects non-uuid product ids and unknown keys', () => {
    expect(configSchema.safeParse({ ...defaultConfig, productIds: ['nope'] }).success).toBe(false);
    expect(configSchema.safeParse({ ...defaultConfig, productIds: [ID], cost: 1 }).success).toBe(
      false,
    );
  });
  it('keeps only digits for wa.me and rejects non-numbers', () => {
    expect(whatsappDigits('+51 900-000-000')).toBe('51900000000');
    expect(whatsappDigits('abc')).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits('1'.repeat(16))).toBeNull();
  });
});
