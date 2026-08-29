import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { amountInWords, buildInvoiceXml, computeTotals } from './ubl';
import type { EmissionInvoice, EmissionLine } from './types';
import { SUNAT_VIGENTE_IGV_RATES } from '$lib/finance/igv-rates';

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
 * S3 of 2026-08-17-hub-igv-rate-from-org-config-spec — the invariant SUNAT
 * itself enforces ("totales no consistentes"): the document's declared totals
 * must reconstruct exactly from the line decimals it carries. The rate stopped
 * being a constant in S1, so the arithmetic has to hold for any `igvRate`
 * value the library is handed, not just the one it was built against — that
 * is what this suite proves.
 *
 * IMPORTANT — this is NOT a claim that every rate below is usable in
 * production. A live run against SUNAT's beta validator on 2026-08-29 (matrix
 * in `specs/2026-08-17-hub-igv-rate-from-org-config-s3-actuals.md`, rerun with
 * `bun scripts/emit-beta-test.ts`) proved `sendBill` hard-rejects a document
 * carrying a 10% IGV with fault `soap-env:Client.3462` — SUNAT only accepts a
 * rate that is currently "vigente" for the emitter's regime, and today that is
 * 0.18 alone (`SUNAT_VIGENTE_IGV_RATES` in `$lib/finance/igv-rates`). The
 * settings-write and emission boundaries (`resolveIgvRate`, `PUT
 * /api/finances/settings`) fail closed on anything else. The extra rates below
 * are pure arithmetic fixtures — they exercise the formula's rounding
 * behaviour so a future *vigente* rate is safe to add, and never reach a real
 * document.
 *
 * Asserted on the emitted XML strings, in integer cents — that is the artifact
 * SUNAT parses, and cents make "exactly, no tolerance" literally true instead
 * of a floating-point approximation of it.
 */
describe('S3 — totals-consistency invariant holds for any igvRate value (arithmetic only)', () => {
  // Only 0.18 is SUNAT-vigente today; 0.10/0.08/0.05 are hypothetical
  // fixtures used to pin the rounding formula, not rates the product accepts.
  const RATES = [0.18, 0.1, 0.08, 0.05];

  /** '107.27' → 10727. Also pins the 2-decimal format SUNAT requires. */
  function cents(decimal: string): number {
    expect(decimal).toMatch(/^\d+\.\d{2}$/);
    return Math.round(Number(decimal) * 100);
  }

  function amount(xml: string, tag: string): string {
    const m = xml.match(new RegExp(`<${tag} currencyID="PEN">([^<]+)</${tag}>`));
    if (!m) throw new Error(`no <${tag}> in document`);
    return m[1];
  }

  function parseInvoice(xml: string) {
    const [header, ...lineBlocks] = xml.split('<cac:InvoiceLine>');
    return {
      // Document level lives before the first InvoiceLine.
      lineExtension: cents(amount(header, 'cbc:LineExtensionAmount')),
      igv: cents(amount(header, 'cbc:TaxAmount')),
      taxInclusive: cents(amount(header, 'cbc:TaxInclusiveAmount')),
      payable: cents(amount(header, 'cbc:PayableAmount')),
      percents: [...xml.matchAll(/<cbc:Percent>([^<]+)<\/cbc:Percent>/g)].map((m) => m[1]),
      lines: lineBlocks.map((block) => ({
        taxable: cents(amount(block, 'cbc:LineExtensionAmount')),
        igv: cents(amount(block, 'cbc:TaxAmount')),
      })),
    };
  }

  function lineSetsFor(rate: number): Record<string, EmissionLine[]> {
    // A net of exactly 10.00 at this rate's divisor — the "no rounding to do"
    // cell, which is where an off-by-a-céntimo split would show up cleanest.
    const exactMultiple = Math.round(10 * (1 + rate) * 100) / 100;
    return {
      '1 line': [{ description: 'Consulta', quantity: 1, unitPriceInclTax: 19.9 }],
      '3 lines with odd céntimos': base.lines,
      '1 line x quantity 7': [{ description: 'Ampolla', quantity: 7, unitPriceInclTax: 3.33 }],
      'inclusive price is an exact multiple of the divisor': [
        { description: 'Sesion', quantity: 1, unitPriceInclTax: exactMultiple },
      ],
    };
  }

  for (const igvRate of RATES) {
    for (const [setName, lines] of Object.entries(lineSetsFor(igvRate))) {
      it(`rate ${igvRate}, ${setName}: lines reconstruct the document totals exactly`, () => {
        const doc = parseInvoice(buildInvoiceXml({ ...base, igvRate, lines }));
        expect(doc.lines).toHaveLength(lines.length);

        for (const [i, l] of doc.lines.entries()) {
          // The line's own split reconstructs the amount the customer paid.
          const paid = Math.round(lines[i].quantity * lines[i].unitPriceInclTax * 100);
          expect(l.taxable + l.igv).toBe(paid);
          // …and the split agrees with the percent the same document declares,
          // within the céntimo that rounding to 2dp can cost (SUNAT re-derives
          // IGV from TaxableAmount × Percent and rejects a wider gap).
          expect(Math.abs(l.igv - l.taxable * igvRate)).toBeLessThanOrEqual(1);
        }

        const sumTaxable = doc.lines.reduce((s, l) => s + l.taxable, 0);
        const sumIgv = doc.lines.reduce((s, l) => s + l.igv, 0);
        expect(doc.lineExtension).toBe(sumTaxable);
        expect(doc.igv).toBe(sumIgv);
        expect(doc.lineExtension + doc.igv).toBe(doc.taxInclusive);
        expect(doc.payable).toBe(doc.taxInclusive);

        // One rate, one document: every declared Percent comes from it.
        expect(doc.percents.length).toBe(lines.length);
        for (const p of doc.percents) expect(p).toBe(String(igvRate * 100));
      });
    }
  }

  it('cross-checks the fixture list against the real allowlist: only 0.18 is SUNAT-vigente today', () => {
    expect(SUNAT_VIGENTE_IGV_RATES).toEqual([0.18]);
    expect(RATES.filter((r) => SUNAT_VIGENTE_IGV_RATES.includes(r))).toEqual([0.18]);
  });
});
