import { describe, expect, it } from 'vitest';
import { DEFAULT_IGV_RATE, resolveIgvRate } from './tax';

/**
 * S2 of specs/2026-08-17-hub-igv-rate-from-org-config-spec.md — the single
 * normalization/validation boundary between `fin_settings.tax_rate` and the
 * emission library's required `EmissionInvoice.igvRate`.
 */

/** Asserts the house typed error, not just "it threw". */
function expectInvalidRate(taxRate: number | null | undefined): void {
  try {
    resolveIgvRate({ taxRate });
    expect.unreachable(`resolveIgvRate(${taxRate}) should have thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ name: 'PosError', code: 'invalid_tax_rate' });
  }
}

describe('resolveIgvRate', () => {
  it('passes a configured fraction through unchanged (the storage unit IS a fraction — A1)', () => {
    expect(resolveIgvRate({ taxRate: 0.1 })).toBe(0.1);
    expect(resolveIgvRate({ taxRate: 0.18 })).toBe(0.18);
    expect(resolveIgvRate({ taxRate: 0.08 })).toBe(0.08);
  });

  it('REJECTS a percent-unit value instead of silently dividing it by 100', () => {
    // A1: every writer stores a fraction, so `18` can only be corruption or a
    // hand-edited row. A magnitude heuristic would turn that into a
    // valid-looking (and 100x wrong) document; the spec forbids it.
    expectInvalidRate(18);
  });

  it('falls back to the statutory default when no rate is configured', () => {
    expect(DEFAULT_IGV_RATE).toBe(0.18);
    expect(resolveIgvRate({ taxRate: null })).toBe(DEFAULT_IGV_RATE);
    expect(resolveIgvRate({})).toBe(DEFAULT_IGV_RATE);
    expect(resolveIgvRate(null)).toBe(DEFAULT_IGV_RATE);
    expect(resolveIgvRate(undefined)).toBe(DEFAULT_IGV_RATE);
  });

  it('throws on a zero rate (A2: exonerado/inafecto is a different document, not 0%)', () => {
    expectInvalidRate(0);
  });

  it.each([1.8, 1, -0.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for an out-of-range rate %s',
    (taxRate) => expectInvalidRate(taxRate),
  );
});
