import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOtp, consumeOtp } from './otp-store';

beforeEach(() => vi.useFakeTimers());

describe('otp store', () => {
  it('returns requestId and a 6-digit code, consumable once', () => {
    const { requestId, code } = createOtp({
      userId: 'u1', channel: 'telegram', channelUserId: '12',
    });
    expect(code).toMatch(/^\d{6}$/);
    expect(consumeOtp(requestId, code)).toEqual({
      ok: true, userId: 'u1', channel: 'telegram', channelUserId: '12',
    });
    expect(consumeOtp(requestId, code)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects wrong code', () => {
    const { requestId } = createOtp({ userId: 'u1', channel: 'x', channelUserId: 'y' });
    expect(consumeOtp(requestId, '000000')).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('expires after 10 minutes', () => {
    const { requestId, code } = createOtp({ userId: 'u1', channel: 'x', channelUserId: 'y' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(consumeOtp(requestId, code)).toEqual({ ok: false, reason: 'expired' });
  });
});
