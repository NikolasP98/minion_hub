import { describe, expect, it } from 'vitest';
import { DEFAULT_IGV_RATE, resolveIgvRate } from './tax';
import { SUNAT_VIGENTE_IGV_RATES } from '$lib/finance/igv-rates';

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
  it.each([...SUNAT_VIGENTE_IGV_RATES])(
    'passes the SUNAT-accepted rate %s through unchanged (the storage unit IS a fraction — A1)',
    (rate) => expect(resolveIgvRate({ taxRate: rate })).toBe(rate),
  );

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

  // 2026-08-29 live SUNAT beta: a document at 10% is hard-rejected by `sendBill`
  // (fault soap-env:Client.3462, "debe corresponder con una tasa vigente"), see
  // specs/2026-08-17-hub-igv-rate-from-org-config-s3-actuals.md. These rates are in-range
  // fractions that the OLD `(0, 1)` guard let straight through to emission —
  // this is the stale-row gate: a value persisted before the settings gate
  // existed, or written directly to `fin_settings`, is refused here instead of
  // producing a guaranteed SUNAT rejection.
  it.each([0.1, 0.08, 0.05, 0.105, 0.19, 0.9999])(
    'refuses in-range but non-vigente rate %s (SUNAT fault 3462 territory)',
    (taxRate) => expectInvalidRate(taxRate),
  );

  it('a numeric-column string round-trip still resolves (Postgres numeric → string)', () => {
    // `fin_settings.tax_rate` is a PG `numeric`; the driver can hand back
    // '0.180' rather than 0.18, and mapFinSettings' Number() is what normalizes
    // it. Guard that the allowlist compares the normalized value.
    expect(resolveIgvRate({ taxRate: Number('0.1800') })).toBe(0.18);
  });

  // M1 regression (review round 1, 2026-08-29): `isVigenteIgvRate` matches
  // within 1e-9 of an allowlist entry, but a near-match is NOT the same
  // number as the canonical rate. Returning the raw near-value let
  // `computeTotals` (divides by `1 + igvRate`) and the declared `cbc:Percent`
  // (rounded to 2dp) disagree by a cent on an otherwise-valid document — see
  // `ubl.test.ts`'s "M1" describe block for the full emitted-document check.
  it('canonicalizes a within-tolerance-but-not-exact rate to the exact allowlist value', () => {
    const resolved = resolveIgvRate({ taxRate: 0.1800000009 });
    expect(resolved).toBe(0.18);
    expect(Object.is(resolved, 0.1800000009)).toBe(false);
  });
});
