import { describe, it, expect } from 'vitest';
import { isDniPending, isPendingTooLong } from './crm-dni-pending';

describe('crm.dni_pending — isDniPending', () => {
  it('verified party is never pending', () => {
    expect(isDniPending('12345678', true, null)).toBe(false);
  });

  it('non-DNI-shaped document is not pending', () => {
    expect(isDniPending('20123456789', false, null)).toBe(false); // RUC, 11 digits
  });

  it('never-attempted (null status) IS pending', () => {
    expect(isDniPending('12345678', false, null)).toBe(true);
  });

  it('stuck mid-check ("processing") IS pending', () => {
    expect(isDniPending('12345678', false, 'processing')).toBe(true);
  });

  it('a terminal status ("verified"/"mismatch"/"not_found"/"error") is NOT pending', () => {
    expect(isDniPending('12345678', false, 'mismatch')).toBe(false);
  });
});

describe('crm.dni_pending — isPendingTooLong boundary', () => {
  const since = new Date('2026-10-08T10:00:00Z');

  it('1 day 23h pending is NOT too long', () => {
    const now = new Date(since.getTime() + (2 * 24 - 1) * 60 * 60 * 1000);
    expect(isPendingTooLong(since, now)).toBe(false);
  });

  it('exactly 2 days pending IS too long (boundary is inclusive)', () => {
    const now = new Date(since.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(isPendingTooLong(since, now)).toBe(true);
  });
});
