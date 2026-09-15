import { describe, it, expect } from 'vitest';
import { PosError } from '$server/services/pos.service';
import { rethrowPosError } from './_errors';

/** The booking UI branches on these: a package that can't cover the session is
 *  a 409 conflict, not a 400 bad request (spec §3.2). */
describe('rethrowPosError', () => {
  it.each(['package_exhausted', 'package_expired', 'package_cancelled'])('%s → 409', (code) => {
    expect(() => rethrowPosError(new PosError('nope', code))).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it('not_found → 404, unknown codes → 400', () => {
    expect(() => rethrowPosError(new PosError('gone', 'not_found'))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => rethrowPosError(new PosError('huh', 'weird_code'))).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('re-throws a non-PosError untouched', () => {
    const boom = new Error('boom');
    expect(() => rethrowPosError(boom)).toThrow(boom);
  });
});
