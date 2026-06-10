import { describe, it, expect } from 'vitest';
import { normalizeChannelUserId } from './channel-claim.service';

describe('normalizeChannelUserId', () => {
  it('strips non-digits from whatsapp numbers (E.164 digits, no +)', () => {
    expect(normalizeChannelUserId('whatsapp', '+51 922 286 663')).toBe('51922286663');
    expect(normalizeChannelUserId('whatsapp', '(555) 010-2030')).toBe('5550102030');
  });

  it('strips a leading @ from telegram handles', () => {
    expect(normalizeChannelUserId('telegram', '@nikolas')).toBe('nikolas');
    expect(normalizeChannelUserId('telegram', ' 123456789 ')).toBe('123456789');
  });

  it('passes through unknown channels trimmed', () => {
    expect(normalizeChannelUserId('discord', '  abc#123  ')).toBe('abc#123');
  });
});
