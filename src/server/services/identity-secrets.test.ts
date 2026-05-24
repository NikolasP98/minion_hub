import { describe, it, expect } from 'vitest';
import { encryptAdc, decryptAdc, type GoogleAdc } from './identity-secrets';

const adc: GoogleAdc = {
  client_id: 'cid.apps.googleusercontent.com',
  client_secret: 'secret-xyz',
  refresh_token: '1//refresh-token-value',
  type: 'authorized_user',
};

describe('identity-secrets', () => {
  it('round-trips an ADC blob through encrypt/decrypt', () => {
    const enc = encryptAdc(adc);
    expect(typeof enc.ciphertext).toBe('string');
    expect(typeof enc.iv).toBe('string');
    expect(enc.ciphertext).not.toContain('refresh-token-value'); // not plaintext
    const back = decryptAdc(enc.ciphertext, enc.iv);
    expect(back).toEqual(adc);
  });

  it('produces a distinct iv each call (random nonce)', () => {
    const a = encryptAdc(adc);
    const b = encryptAdc(adc);
    expect(a.iv).not.toBe(b.iv);
  });
});
