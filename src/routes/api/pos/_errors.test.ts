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

  // updateSellable's kind/trackStock/uom refusals (2026-08-17-hub-updatesellable-
  // silent-drop-spec §S1) rely on the default 400 mapping, not a special case.
  it.each(['kind_derived', 'stock_tracking_immutable', 'uom_immutable'])(
    'returns 400 for the sellable-edit refusal code %s',
    (code) => {
      expect(handlePosError(new PosError('x', code)).status).toBe(400);
    },
  );

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
