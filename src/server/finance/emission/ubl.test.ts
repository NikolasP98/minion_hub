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
  emitter: {
    ruc: '20611172967',
    razonSocial: 'FACES BETA SAC',
    ubigeo: '150101',
    address: 'AV BETA 123',
  },
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
    expect(xml).toContain(
      `<cbc:PayableAmount currencyID="PEN">${totals.payableAmount.toFixed(2)}</cbc:PayableAmount>`,
    );
    expect(xml).toContain(
      `<cbc:LineExtensionAmount currencyID="PEN">${totals.lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>`,
    );
  });

  it('escapes XML-special characters in free-text fields (no CDATA — plain escaped text)', () => {
    const xml = buildInvoiceXml({ ...base, client: { ...base.client, name: 'CLIENTE "A" & <B>' } });
    expect(xml).toContain(
      '<cbc:RegistrationName>CLIENTE &quot;A&quot; &amp; &lt;B&gt;</cbc:RegistrationName>',
    );
    expect(xml).not.toContain('CDATA');
  });
});

describe('igvRate (S1 — required input, no module-level default)', () => {
  // Captured from the pre-S1 code (module-level `const IGV_RATE = 0.18`) on
  // this exact `base` fixture — proves the signature change is behavior-
  // neutral at 18%. Regenerate only if `base` itself changes.
  const golden = readFileSync(
    join(import.meta.dirname, '__fixtures__/invoice-18pct-golden.xml'),
    'utf8',
  );

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

/**
 * Regression for the 2026-10-10 shadow-emission incident: SUNAT fault 3105
 * ("El XML debe contener al menos un tributo por linea de afectacion por
 * IGV") on two boletas whose lines included a catalog-price-zero item and a
 * fully-discounted service. A zero-value line is an operación gratuita, not a
 * gravada line worth nothing.
 */
describe('operaciones gratuitas (zero-value lines)', () => {
  // POS-2026-00016, the ticket that was rejected.
  const mixed: EmissionInvoice = {
    ...base,
    lines: [
      // catalog price 0 — no better reference value exists
      { description: 'Faja L', quantity: 1, unitPriceInclTax: 0, referenceUnitPriceInclTax: 0 },
      // list price 50, 100% discount
      {
        description: 'Reserva de Consulta',
        quantity: 1,
        unitPriceInclTax: 0,
        referenceUnitPriceInclTax: 50,
      },
      { description: 'Afinamiento de Rostro (completo)', quantity: 1, unitPriceInclTax: 1700 },
    ],
  };

  it('classifies zero-total lines as gratuitas and keeps them out of every onerous total', () => {
    const totals = computeTotals(mixed);
    expect(totals.lines.map((l) => l.gratuita)).toEqual([true, true, false]);
    // 1700 incl IGV -> 1440.68 + 259.32
    expect(totals.lineExtensionAmount).toBe(1440.68);
    expect(totals.igvAmount).toBe(259.32);
    expect(totals.taxInclusiveAmount).toBe(1700);
    expect(totals.payableAmount).toBe(1700);
    // valor de venta of the gratuitas: 0 + round(50/1.18) = 42.37
    expect(totals.gratuitaAmount).toBe(42.37);
    expect(totals.allGratuita).toBe(false);
  });

  it('declares each gratuita line under tributo 9998 with afectación 31 and no taxable base', () => {
    const xml = buildInvoiceXml(mixed);
    const lines = xml.split('<cac:InvoiceLine>').slice(1);
    expect(lines).toHaveLength(3);

    // the 100%-discounted line carries its list price as valor referencial (catálogo 16 code 02)
    expect(lines[1]).toContain('<cbc:LineExtensionAmount currencyID="PEN">0.00');
    expect(lines[1]).toContain('<cbc:PriceAmount currencyID="PEN">42.370000</cbc:PriceAmount>');
    expect(lines[1]).toContain('<cbc:PriceTypeCode>02</cbc:PriceTypeCode>');
    expect(lines[1]).toContain('<cbc:TaxExemptionReasonCode>31</cbc:TaxExemptionReasonCode>');
    expect(lines[1]).toContain('<cbc:ID>9998</cbc:ID>');
    expect(lines[1]).toContain('<cbc:Name>INAFECTO</cbc:Name>');
    expect(lines[1]).toContain('<cbc:TaxTypeCode>FRE</cbc:TaxTypeCode>');
    // the gratuita declares NO IGV and no gravada base — that is the 3105 fix
    expect(lines[1]).not.toContain('<cbc:TaxExemptionReasonCode>10<');
    expect(lines[1]).not.toContain('<cbc:Name>IGV</cbc:Name>');
    expect(
      lines[1].match(/<cbc:TaxableAmount currencyID="PEN">0\.00<\/cbc:TaxableAmount>/g),
    ).toHaveLength(1);

    // the catalog-price-zero line falls back to a zero reference value
    expect(lines[0]).toContain('<cbc:PriceAmount currencyID="PEN">0.000000</cbc:PriceAmount>');
    expect(lines[0]).toContain('<cbc:PriceTypeCode>02</cbc:PriceTypeCode>');

    // the paid line is untouched: afectación 10, tributo 1000
    expect(lines[2]).toContain('<cbc:TaxExemptionReasonCode>10</cbc:TaxExemptionReasonCode>');
    expect(lines[2]).toContain('<cbc:ID>1000</cbc:ID>');
    expect(lines[2]).toContain('<cbc:LineExtensionAmount currencyID="PEN">1440.68');
  });

  it('adds the document gratuitas TaxSubtotal and excludes gratuitas from LegalMonetaryTotal', () => {
    const xml = buildInvoiceXml(mixed);
    const docTaxTotal = xml.slice(
      xml.indexOf('<cac:PaymentTerms>'),
      xml.indexOf('<cac:LegalMonetaryTotal>'),
    );
    expect(docTaxTotal).toContain('<cbc:TaxAmount currencyID="PEN">259.32</cbc:TaxAmount>');
    expect(docTaxTotal).toContain('<cbc:TaxableAmount currencyID="PEN">42.37</cbc:TaxableAmount>');
    expect(docTaxTotal).toContain('<cbc:ID>9998</cbc:ID>');
    expect(docTaxTotal.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);

    expect(xml).toContain(
      '<cbc:TaxInclusiveAmount currencyID="PEN">1700.00</cbc:TaxInclusiveAmount>',
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">1700.00</cbc:PayableAmount>');
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="PEN">1440.68</cbc:LineExtensionAmount>',
    );
  });

  it('omits the gratuitas TaxSubtotal and legend 1002 when every line is paid', () => {
    const xml = buildInvoiceXml(base);
    expect(xml).not.toContain('9998');
    expect(xml).not.toContain('languageLocaleID="1002"');
    expect(xml).not.toContain('<cbc:PriceTypeCode>02</cbc:PriceTypeCode>');
  });

  it('carries legend 1002 only when EVERY line is gratuita', () => {
    // guía factura UBL 2.1: 1002 is "aplicable solo en el caso que TODAS las
    // operaciones ... sean gratuitas" — a mixed invoice must not carry it.
    expect(buildInvoiceXml(mixed)).not.toContain('languageLocaleID="1002"');

    const allFree: EmissionInvoice = { ...base, lines: [mixed.lines[1]] };
    const totals = computeTotals(allFree);
    expect(totals.allGratuita).toBe(true);
    expect(totals.payableAmount).toBe(0);
    const xml = buildInvoiceXml(allFree);
    expect(xml).toContain(
      '<cbc:Note languageLocaleID="1002">TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE</cbc:Note>',
    );
    expect(xml).toContain('<cbc:PayableAmount currencyID="PEN">0.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:Note languageLocaleID="1000">SON CERO CON 00/100 SOLES</cbc:Note>');
  });

  it('falls back to the effective unit price when no reference price is supplied', () => {
    const totals = computeTotals({
      ...base,
      lines: [{ description: 'Watershield', quantity: 1, unitPriceInclTax: 0 }],
    });
    expect(totals.lines[0].gratuita).toBe(true);
    expect(totals.gratuitaAmount).toBe(0);
  });

  it('onerous totals still equal the plain sum of the onerous lines', () => {
    const totals = computeTotals(mixed);
    const onerous = totals.lines.filter((l) => !l.gratuita);
    expect(totals.lineExtensionAmount).toBeCloseTo(
      onerous.reduce((s, l) => s + l.totalExclTax, 0),
      10,
    );
    expect(totals.igvAmount).toBeCloseTo(
      onerous.reduce((s, l) => s + l.igv, 0),
      10,
    );
    expect(totals.taxInclusiveAmount).toBeCloseTo(
      onerous.reduce((s, l) => s + l.totalInclTax, 0),
      10,
    );
  });
});
