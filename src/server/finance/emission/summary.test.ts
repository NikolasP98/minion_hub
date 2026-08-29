import { describe, expect, it } from 'vitest';
import {
  bajaId,
  buildBajaXml,
  buildResumenXml,
  resumenId,
  type BajaLine,
  type ResumenLine,
} from './summary';
import type { EmissionInvoice } from './types';

const boleta: EmissionInvoice = {
  docType: '03',
  serie: 'B998',
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
  lines: [{ description: 'Servicio de prueba', quantity: 1, unitPriceInclTax: 118 }],
};

const emitter = { ruc: '20611172967', razonSocial: 'FACES BETA SAC' };

describe('resumenId / bajaId', () => {
  it('follow the RC/RA-YYYYMMDD-N naming law from the resumen/baja own IssueDate', () => {
    expect(resumenId('2026-08-14', '1')).toBe('RC-20260814-1');
    expect(bajaId('2026-08-14', '7')).toBe('RA-20260814-7');
  });
});

describe('buildResumenXml', () => {
  const lines: ResumenLine[] = [{ invoice: boleta, estado: '1' }];

  it('builds a well-formed RC with id, dates, and one SummaryDocumentsLine per boleta', () => {
    const xml = buildResumenXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines,
    });
    expect(xml).toContain('<cbc:ID>RC-20260814-1</cbc:ID>');
    expect(xml).toContain('<cbc:ReferenceDate>2026-08-14</cbc:ReferenceDate>');
    expect(xml).toContain('<cbc:IssueDate>2026-08-14</cbc:IssueDate>');
    expect(xml).toContain('<cbc:ID>B998-1</cbc:ID>'); // the line's serie-numero
    expect(xml).toContain('<cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>');
    expect(xml).toContain('<cbc:ConditionCode>1</cbc:ConditionCode>');
    expect(xml).toContain(
      '<cbc:CustomerAssignedAccountID>12345678</cbc:CustomerAssignedAccountID>',
    );
    expect(xml).toContain('<sac:TotalAmount currencyID="PEN">118.00</sac:TotalAmount>');
    expect(xml).toContain('<cbc:URI>#SignatureSP</cbc:URI>');
    expect(xml).toMatch(/<sac:SummaryDocumentsLine>/);
  });

  it('derives per-line gravada/IGV from computeTotals, not accepted input', () => {
    const xml = buildResumenXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines,
    });
    // 118 incl tax @18% => 100.00 gravada + 18.00 IGV
    expect(xml).toContain('<cbc:PaidAmount currencyID="PEN">100.00</cbc:PaidAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="PEN">18.00</cbc:TaxAmount>');
  });

  it('supports multiple lines with distinct estado (e.g. one anulada)', () => {
    const boleta2: EmissionInvoice = { ...boleta, correlativo: '2' };
    const xml = buildResumenXml({
      emitter,
      correlativo: '2',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-14',
      lines: [
        { invoice: boleta, estado: '1' },
        { invoice: boleta2, estado: '3' },
      ],
    });
    expect(xml.match(/<sac:SummaryDocumentsLine>/g)).toHaveLength(2);
    expect(xml).toContain('<cbc:ID>B998-2</cbc:ID>');
    expect(xml).toContain('<cbc:ConditionCode>3</cbc:ConditionCode>');
  });

  /**
   * S3 of 2026-08-17-hub-igv-rate-from-org-config-spec: the resumen is the
   * second home the hardcoded rate used to have. `summaryLineXml` re-derives
   * each boleta's gravada/IGV through `computeTotals`, so it must move with the
   * org's rate — and each line must still balance, since SUNAT re-adds them.
   */
  describe('S3 — per-boleta totals follow the boleta’s own igvRate', () => {
    /** '107.27' → 10727 — cents make “exactly” literal, and pin the 2dp format. */
    function cents(decimal: string): number {
      expect(decimal).toMatch(/^\d+\.\d{2}$/);
      return Math.round(Number(decimal) * 100);
    }

    function summaryLines(xml: string) {
      return xml
        .split('<sac:SummaryDocumentsLine>')
        .slice(1)
        .map((block) => {
          const pick = (tag: string) => {
            const m = block.match(new RegExp(`<${tag} currencyID="PEN">([^<]+)</${tag}>`));
            if (!m) throw new Error(`no <${tag}> in summary line`);
            return cents(m[1]);
          };
          return {
            total: pick('sac:TotalAmount'),
            gravada: pick('cbc:PaidAmount'),
            igv: pick('cbc:TaxAmount'),
          };
        });
    }

    function build(invoices: EmissionInvoice[]): string {
      return buildResumenXml({
        emitter,
        correlativo: '1',
        referenceDate: '2026-08-14',
        issueDate: '2026-08-14',
        lines: invoices.map((invoice) => ({ invoice, estado: '1' }) as ResumenLine),
      });
    }

    const oddCentimos: EmissionInvoice = {
      ...boleta,
      correlativo: '2',
      lines: [
        { description: 'Servicio A', quantity: 3, unitPriceInclTax: 10.33 },
        { description: 'Servicio B', quantity: 1, unitPriceInclTax: 7.77 },
      ],
    };

    it('a 0.10 resumen differs from the 0.18 one, line by line', () => {
      const at18 = summaryLines(build([boleta]));
      const at10 = summaryLines(build([{ ...boleta, igvRate: 0.1 }]));
      // Same 118.00 the customer paid, split by a different rate.
      expect(at18[0]).toEqual({ total: 11800, gravada: 10000, igv: 1800 });
      expect(at10[0]).toEqual({ total: 11800, gravada: 10727, igv: 1073 });
    });

    it.each([0.18, 0.1, 0.08, 0.05])(
      'rate %s: every boleta’s gravada + IGV == its declared total, exactly',
      (igvRate) => {
        const invoices = [boleta, oddCentimos].map((b) => ({ ...b, igvRate }));
        const parsed = summaryLines(build(invoices));
        expect(parsed).toHaveLength(2);
        for (const [i, line] of parsed.entries()) {
          expect(line.gravada + line.igv).toBe(line.total);
          const paid = invoices[i].lines.reduce(
            (s, l) => s + Math.round(l.quantity * l.unitPriceInclTax * 100),
            0,
          );
          expect(line.total).toBe(paid);
        }
      },
    );
  });

  it('rejects a non-boleta invoice at runtime', () => {
    const factura: EmissionInvoice = { ...boleta, docType: '01', serie: 'F998' };
    expect(() =>
      buildResumenXml({
        emitter,
        correlativo: '1',
        referenceDate: '2026-08-14',
        issueDate: '2026-08-14',
        lines: [{ invoice: factura, estado: '1' }],
      }),
    ).toThrow(/boletas \(03\) only/);
  });
});

describe('buildBajaXml', () => {
  const facturaLine: BajaLine = {
    docType: '01',
    serie: 'F998',
    correlativo: '1',
    motivo: 'ERROR EN EL COMPROBANTE',
  };

  it('builds a well-formed RA with id, dates, and one VoidedDocumentsLine per doc', () => {
    const xml = buildBajaXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-15',
      lines: [facturaLine],
    });
    expect(xml).toContain('<cbc:ID>RA-20260815-1</cbc:ID>');
    expect(xml).toContain('<cbc:ReferenceDate>2026-08-14</cbc:ReferenceDate>');
    expect(xml).toContain('<cbc:IssueDate>2026-08-15</cbc:IssueDate>');
    expect(xml).toContain('<sac:DocumentSerialID>F998</sac:DocumentSerialID>');
    expect(xml).toContain('<sac:DocumentNumberID>1</sac:DocumentNumberID>');
    expect(xml).toContain(
      '<sac:VoidReasonDescription>ERROR EN EL COMPROBANTE</sac:VoidReasonDescription>',
    );
    expect(xml).toContain('<cbc:URI>#SignatureSP</cbc:URI>');
  });

  it('escapes free-text VoidReasonDescription (no CDATA)', () => {
    const xml = buildBajaXml({
      emitter,
      correlativo: '1',
      referenceDate: '2026-08-14',
      issueDate: '2026-08-15',
      lines: [{ ...facturaLine, motivo: 'ERROR "A" & <B>' }],
    });
    expect(xml).toContain(
      '<sac:VoidReasonDescription>ERROR &quot;A&quot; &amp; &lt;B&gt;</sac:VoidReasonDescription>',
    );
    expect(xml).not.toContain('CDATA');
  });

  it('rejects a boleta at compile time (docType is the "01" literal, not EmissionDocType)', () => {
    // @ts-expect-error docType '03' is not assignable to BajaLine's '01' literal — the compile-time half of the estado-3 typing rule
    const boletaLine: BajaLine = { docType: '03', serie: 'B998', correlativo: '1', motivo: 'x' };
    void boletaLine;
  });

  it('rejects a boleta at runtime when the type is bypassed (e.g. an untyped JS caller)', () => {
    const boletaLine = {
      docType: '03',
      serie: 'B998',
      correlativo: '1',
      motivo: 'x',
    } as unknown as BajaLine;
    expect(() =>
      buildBajaXml({
        emitter,
        correlativo: '1',
        referenceDate: '2026-08-14',
        issueDate: '2026-08-15',
        lines: [boletaLine],
      }),
    ).toThrow(/facturas \(01\) only/);
  });
});
