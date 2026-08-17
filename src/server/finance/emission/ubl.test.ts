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

describe('igvRate (S1 — required input, no module-level default)', () => {
  // Captured from the pre-S1 code (module-level `const IGV_RATE = 0.18`) on
  // this exact `base` fixture — proves the signature change is behavior-
  // neutral at 18%. Regenerate only if `base` itself changes.
  const golden = readFileSync(join(import.meta.dirname, '__fixtures__/invoice-18pct-golden.xml'), 'utf8');

  it('GOLDEN PARITY: igvRate 0.18 is byte-identical to the pre-change output', () => {
    expect(buildInvoiceXml(base)).toBe(golden);
  });

  it('a non-0.18 rate on the same fixture changes IGV, valorVenta, and cbc:Percent', () => {
    const at18 = computeTotals(base);
    const at10 = computeTotals({ ...base, igvRate: 0.1 });

    expect(at10.igvAmount).not.toBe(at18.igvAmount);
    expect(at10.lineExtensionAmount).not.toBe(at18.lineExtensionAmount);

    const xml18 = buildInvoiceXml(base);
    const xml10 = buildInvoiceXml({ ...base, igvRate: 0.1 });
    expect(xml10).not.toBe(xml18);
    expect(xml18).toContain('<cbc:Percent>18</cbc:Percent>');
    expect(xml10).toContain('<cbc:Percent>10</cbc:Percent>');
    expect(xml10).not.toContain('<cbc:Percent>18</cbc:Percent>');
  });

  it.each([0.18, 0.1, 0.08])('cbc:Percent == igvRate * 100 for rate %s', (igvRate) => {
    const xml = buildInvoiceXml({ ...base, igvRate });
    const expectedPercent = String(igvRate * 100);
    const matches = xml.match(/<cbc:Percent>([^<]+)<\/cbc:Percent>/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m).toBe(`<cbc:Percent>${expectedPercent}</cbc:Percent>`);
    }
  });

  it('omitting igvRate is a compile-time error', () => {
    const { igvRate: _igvRate, ...rest } = base;
    // @ts-expect-error igvRate is required on EmissionInvoice — no default, no fallback
    const invoice: EmissionInvoice = { ...rest };
    void invoice;
  });
});
