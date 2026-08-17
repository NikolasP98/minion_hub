import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IGV_RATE, resolveIgvRate } from './tax';
import { buildInvoiceXml } from './emission/ubl';
import type { EmissionInvoice } from './emission/types';

describe('resolveIgvRate', () => {
  it('passes a configured non-statutory rate through untouched (storage unit is a fraction)', () => {
    expect(resolveIgvRate({ taxRate: 0.1 })).toBe(0.1);
    expect(resolveIgvRate({ taxRate: 0.08 })).toBe(0.08);
    expect(resolveIgvRate({ taxRate: 0.18 })).toBe(0.18);
  });

  it('falls back to the statutory default when the org never configured a rate', () => {
    expect(resolveIgvRate({ taxRate: null })).toBe(DEFAULT_IGV_RATE);
    expect(resolveIgvRate({})).toBe(DEFAULT_IGV_RATE);
    expect(resolveIgvRate(null)).toBe(DEFAULT_IGV_RATE);
    expect(DEFAULT_IGV_RATE).toBe(0.18);
  });

  it('REJECTS a percent-shaped value instead of guessing it meant a fraction', () => {
    // fin_settings.tax_rate is a FRACTION (see the A1 evidence in tax.ts). A
    // stored 18 is a data-entry bug, not a unit to be inferred — converting it
    // by magnitude would turn a typo into a valid-looking SUNAT document.
    expect(() => resolveIgvRate({ taxRate: 18 })).toThrow(/not usable for SUNAT emission/);
    expect(() => resolveIgvRate({ taxRate: 18 })).toThrowError(
      expect.objectContaining({ name: 'PosError', code: 'invalid_tax_rate' }),
    );
  });

  it('throws on 0 — a zero-rated operation is a different UBL document, not a 0% invoice', () => {
    expect(() => resolveIgvRate({ taxRate: 0 })).toThrowError(
      expect.objectContaining({ code: 'invalid_tax_rate' }),
    );
  });

  it('throws on out-of-range, non-finite and unparseable rates', () => {
    for (const bad of [1.8, 1, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveIgvRate({ taxRate: bad })).toThrowError(
        expect.objectContaining({ code: 'invalid_tax_rate' }),
      );
    }
  });
});

describe('zero-regression proof for orgs that never configured a rate', () => {
  it('the fallback reproduces the pre-change document byte for byte', () => {
    const golden = readFileSync(
      join(import.meta.dirname, 'emission', '__fixtures__', 'golden-invoice-igv-18pct.xml'),
      'utf8',
    );
    const invoice: EmissionInvoice = {
      docType: '03',
      serie: 'B999',
      correlativo: '1',
      issueDate: '2026-08-14',
      currency: 'PEN',
      igvRate: resolveIgvRate({ taxRate: null }),
      emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC', ubigeo: '150101', address: 'AV BETA 123' },
      client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA' },
      lines: [
        { description: 'Line 1', quantity: 3, unitPriceInclTax: 10.33 },
        { description: 'Line 2', quantity: 1, unitPriceInclTax: 7.77 },
        { description: 'Line 3', quantity: 2, unitPriceInclTax: 4.45 },
      ],
    };
    expect(buildInvoiceXml(invoice)).toBe(golden);
  });
});
