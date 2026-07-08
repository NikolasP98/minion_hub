import { describe, it, expect } from 'vitest';
import { PosError } from '$server/services/pos.service';
import { handlePosError } from './_errors';

describe('handlePosError', () => {
  it('returns 400 {error, code} for unmapped codes', async () => {
    const res = handlePosError(new PosError('x', 'payment_mismatch'));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'x', code: 'payment_mismatch' });
  });

  it('returns 409 for conflict codes', async () => {
    const res = handlePosError(new PosError('open first', 'no_open_shift'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'open first', code: 'no_open_shift' });
  });

  it('returns 404 for not_found', () => {
    expect(handlePosError(new PosError('nope', 'not_found')).status).toBe(404);
  });

  it('re-throws non-PosError untouched', () => {
    const boom = new Error('boom');
    expect(() => handlePosError(boom)).toThrow(boom);
  });
});
