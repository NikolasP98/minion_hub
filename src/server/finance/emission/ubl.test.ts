import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { amountInWords, buildInvoiceXml, computeTotals } from './ubl';
import type { EmissionInvoice } from './types';

const base: EmissionInvoice = {
  docType: '03',
  serie: 'B999',
  correlativo: '1',
  issueDate: '2026-08-14',
  currency: 'PEN',
  igvRate: 0.18,
  emitter: { ruc: '20611172967', razonSocial: 'FACES BETA SAC', ubigeo: '150101', address: 'AV BETA 123' },
  client: { docType: '1', docNumber: '12345678', name: 'CLIENTE DE PRUEBA' },
  lines: [
    { description: 'Line 1', quantity: 3, unitPriceInclTax: 10.33 },
    { description: 'Line 2', quantity: 1, unitPriceInclTax: 7.77 },
    { description: 'Line 3', quantity: 2, unitPriceInclTax: 4.45 },
  ],
};

/** Captured from commit a3b57e2 — the last build BEFORE `igvRate` existed and
 *  the rate was the module-level `const IGV_RATE = 0.18`. Byte-equality against
 *  it is the proof that threading the rate changed nothing at 18%. */
const GOLDEN_18PCT = readFileSync(
  join(import.meta.dirname, '__fixtures__', 'golden-invoice-igv-18pct.xml'),
  'utf8',
);

/** `<cbc:Percent>` values in document order (one per InvoiceLine). */
function declaredPercents(xml: string): string[] {
  return [...xml.matchAll(/<cbc:Percent>([^<]*)<\/cbc:Percent>/g)].map((m) => m[1]);
}

describe('computeTotals', () => {
  it('keeps document totals exactly consistent with the sum of line totals (odd céntimos)', () => {
    const totals = computeTotals(base);
    const sumExcl = totals.lines.reduce((s, l) => s + l.totalExclTax, 0);
    const sumIgv = totals.lines.reduce((s, l) => s + l.igv, 0);
    const sumIncl = totals.lines.reduce((s, l) => s + l.totalInclTax, 0);
    expect(totals.lineExtensionAmount).toBeCloseTo(sumExcl, 10);
    expect(totals.igvAmount).toBeCloseTo(sumIgv, 10);
    expect(totals.taxInclusiveAmount).toBeCloseTo(sumIncl, 10);
    expect(totals.payableAmount).toBe(totals.taxInclusiveAmount);
    // every line's own exclTax + igv reconstructs its inclTax total exactly
    for (const l of totals.lines) {
      expect(Math.round((l.totalExclTax + l.igv) * 100) / 100).toBe(l.totalInclTax);
    }
  });

  it('rounds each line half-up to 2 decimals', () => {
    const totals = computeTotals(base);
    for (const l of totals.lines) {
      expect(l.totalInclTax).toBe(Math.round(l.totalInclTax * 100) / 100);
      expect(l.totalExclTax).toBe(Math.round(l.totalExclTax * 100) / 100);
    }
  });
});

describe('amountInWords', () => {
  it('renders a known amount', () => {
    expect(amountInWords(236)).toBe('SON DOSCIENTOS TREINTA Y SEIS CON 00/100 SOLES');
  });

  it('handles cents, teens, and the twenty-one contraction', () => {
    expect(amountInWords(21.5)).toBe('SON VEINTIUNO CON 50/100 SOLES');
    expect(amountInWords(0.05)).toBe('SON CERO CON 05/100 SOLES');
  });
});

describe('buildInvoiceXml', () => {
  it('builds a well-formed document with the expected ID, type code, and extension placeholder', () => {
    const xml = buildInvoiceXml(base);
    expect(xml).toContain('<cbc:ID>B999-1</cbc:ID>');
    expect(xml).toContain('<cbc:InvoiceTypeCode listID="0101">03</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<ext:ExtensionContent/>');
    expect(xml).toContain('<cbc:URI>#SignatureSP</cbc:URI>');
    // one InvoiceLine per input line
    expect(xml.match(/<cac:InvoiceLine>/g)).toHaveLength(3);
  });

  it('reports document totals consistent with LegalMonetaryTotal', () => {
    const totals = computeTotals(base);
    const xml = buildInvoiceXml(base);
    expect(xml).toContain(`<cbc:PayableAmount currencyID="PEN">${totals.payableAmount.toFixed(2)}</cbc:PayableAmount>`);
    expect(xml).toContain(`<cbc:LineExtensionAmount currencyID="PEN">${totals.lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>`);
  });

  it('escapes XML-special characters in free-text fields (no CDATA — plain escaped text)', () => {
    const xml = buildInvoiceXml({ ...base, client: { ...base.client, name: 'CLIENTE "A" & <B>' } });
    expect(xml).toContain('<cbc:RegistrationName>CLIENTE &quot;A&quot; &amp; &lt;B&gt;</cbc:RegistrationName>');
    expect(xml).not.toContain('CDATA');
  });
});

describe('igvRate is threaded, not assumed', () => {
  it('GOLDEN PARITY: at igvRate 0.18 the document is byte-identical to the pre-change output', () => {
    expect(buildInvoiceXml(base)).toBe(GOLDEN_18PCT);
  });

  it('a non-0.18 rate changes IGV, valorVenta AND the declared percent', () => {
    const at18 = computeTotals(base);
    const at10 = computeTotals({ ...base, igvRate: 0.1 });

    expect(at10.igvAmount).not.toBe(at18.igvAmount);
    expect(at10.lineExtensionAmount).not.toBe(at18.lineExtensionAmount);
    // the inclusive total is the source amount — the rate only moves the split
    expect(at10.taxInclusiveAmount).toBe(at18.taxInclusiveAmount);
    // 47.66 incl @10% => 43.32 net + 4.34 IGV (per-line splits, summed)
    expect(at10.lineExtensionAmount).toBe(43.32);
    expect(at10.igvAmount).toBe(4.34);
    expect(at10.lineExtensionAmount + at10.igvAmount).toBeCloseTo(at10.taxInclusiveAmount, 10);

    const xml18 = buildInvoiceXml(base);
    const xml10 = buildInvoiceXml({ ...base, igvRate: 0.1 });
    expect(xml10).not.toBe(xml18);
    expect(declaredPercents(xml18)).toEqual(['18', '18', '18']);
    expect(declaredPercents(xml10)).toEqual(['10', '10', '10']);
    expect(xml10).toContain('<cbc:TaxAmount currencyID="PEN">4.34</cbc:TaxAmount>');
    expect(xml10).toContain('<cbc:LineExtensionAmount currencyID="PEN">43.32</cbc:LineExtensionAmount>');
  });

  it('declares cbc:Percent == igvRate * 100 for every supported rate', () => {
    for (const [rate, percent] of [
      [0.18, '18'],
      [0.1, '10'],
      [0.08, '8'],
      [0.055, '5.5'],
    ] as const) {
      const percents = declaredPercents(buildInvoiceXml({ ...base, igvRate: rate }));
      expect(percents).toHaveLength(base.lines.length);
      expect(new Set(percents)).toEqual(new Set([percent]));
    }
  });

  it('the divisor and the declared percent come from ONE value (they cannot disagree)', () => {
    // Reconstruct the rate from the XML two independent ways: from the declared
    // percent, and from the amounts. A second hardcoded site would break this.
    for (const rate of [0.18, 0.1, 0.08] as const) {
      const xml = buildInvoiceXml({ ...base, igvRate: rate });
      const declared = Number(declaredPercents(xml)[0]) / 100;
      const totals = computeTotals({ ...base, igvRate: rate });
      expect(declared).toBeCloseTo(rate, 10);
      expect(totals.igvAmount / totals.lineExtensionAmount).toBeCloseTo(rate, 3);
    }
  });

  it('omitting igvRate is a compile-time error', () => {
    // @ts-expect-error igvRate is required on EmissionInvoice — an emission
    // document must always state the rate it was derived with
    const noRate: EmissionInvoice = {
      docType: '03',
      serie: 'B999',
      correlativo: '1',
      issueDate: '2026-08-14',
      currency: 'PEN',
      emitter: base.emitter,
      client: base.client,
      lines: base.lines,
    };
    void noRate;
  });
});
